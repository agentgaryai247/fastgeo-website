module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { businessName, trade, city, website, email } = req.body;

  if (!businessName || !trade || !city || !email) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  try {
    let seoScore = 0;
    let geoScore = 0;
    let contentScore = 0;
    let technicalScore = 0;
    const findings = [];
    let pageText = '';
    let hasWebsite = false;

    // ── If they provided a website, fetch and analyse it ──
    if (website) {
      hasWebsite = true;
      let html = '';

      try {
        const url = website.startsWith('http') ? website : 'https://' + website;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const resp = await fetch(url, {
          headers: { 'User-Agent': 'FastGEO-Scanner/1.0' },
          signal: controller.signal,
          redirect: 'follow'
        });
        clearTimeout(timeout);

        if (resp.ok) {
          html = await resp.text();
        }
      } catch (e) {
        // Website unreachable
        findings.push({ label: 'Website Unreachable', detail: 'We couldn\'t load your website. Check the URL is correct and the site is live.', status: 'fail' });
      }

      if (html) {
        const htmlLower = html.toLowerCase();

        // ── SEO FOUNDATIONS (out of 25) ──

        // Title tag
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
        const title = titleMatch ? titleMatch[1].trim() : '';
        if (title && title.length > 10 && title.length < 70) {
          seoScore += 5;
          findings.push({ label: 'Page Title', detail: 'Good title tag found: "' + title.substring(0, 60) + (title.length > 60 ? '...' : '') + '"', status: 'pass' });
        } else if (title) {
          seoScore += 2;
          findings.push({ label: 'Page Title', detail: title.length > 70 ? 'Title tag is too long (' + title.length + ' chars). Keep it under 60 for best results.' : 'Title tag is very short. Add your business name and main service.', status: 'warning' });
        } else {
          findings.push({ label: 'Page Title', detail: 'No title tag found. This is one of the most important SEO signals — add one immediately.', status: 'fail' });
        }

        // Meta description
        const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/is);
        const metaDesc = metaDescMatch ? metaDescMatch[1].trim() : '';
        if (metaDesc && metaDesc.length > 50 && metaDesc.length < 165) {
          seoScore += 5;
          findings.push({ label: 'Meta Description', detail: 'Good meta description found (' + metaDesc.length + ' chars).', status: 'pass' });
        } else if (metaDesc) {
          seoScore += 2;
          findings.push({ label: 'Meta Description', detail: metaDesc.length > 165 ? 'Meta description is too long. Keep it under 155 characters.' : 'Meta description is very short. Aim for 120-155 characters.', status: 'warning' });
        } else {
          findings.push({ label: 'Meta Description', detail: 'No meta description found. Search engines and AI tools use this to understand your page.', status: 'fail' });
        }

        // H1 tag
        const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
        if (h1Match) {
          seoScore += 5;
          findings.push({ label: 'H1 Heading', detail: 'H1 heading found on the page. Good structure.', status: 'pass' });
        } else {
          findings.push({ label: 'H1 Heading', detail: 'No H1 heading found. Every page needs a clear main heading.', status: 'fail' });
        }

        // H2 tags
        const h2Count = (html.match(/<h2/gi) || []).length;
        if (h2Count >= 2) {
          seoScore += 5;
          findings.push({ label: 'Content Structure', detail: h2Count + ' subheadings found. Well structured content.', status: 'pass' });
        } else if (h2Count === 1) {
          seoScore += 3;
          findings.push({ label: 'Content Structure', detail: 'Only 1 subheading found. More H2s help AI tools understand your content.', status: 'warning' });
        } else {
          findings.push({ label: 'Content Structure', detail: 'No subheadings (H2) found. AI tools struggle to parse unstructured content.', status: 'fail' });
        }

        // SSL
        if (website.startsWith('https') || html.includes('https')) {
          seoScore += 5;
        } else {
          findings.push({ label: 'SSL Certificate', detail: 'Your site may not be using HTTPS. This is a basic trust signal for both Google and AI tools.', status: 'fail' });
        }

        // ── GEO READINESS (out of 25) ──

        // Schema/structured data (4pts)
        const hasSchema = htmlLower.includes('application/ld+json') || htmlLower.includes('itemtype=');
        if (hasSchema) {
          geoScore += 4;
          findings.push({ label: 'Schema Markup', detail: 'Structured data found. This helps AI tools understand your business details.', status: 'pass' });
        } else {
          findings.push({ label: 'Schema Markup', detail: 'No structured data (schema markup) found. This is one of the biggest GEO signals — AI tools rely on it to know what your business does.', status: 'fail' });
        }

        // NAP — Name, Address, Phone (4pts)
        const hasPhone = /(\d{5}\s?\d{6}|\d{4}\s?\d{3}\s?\d{4}|0\d{2,4}\s?\d{3,4}\s?\d{3,4}|\+44)/i.test(html);
        const hasAddress = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i.test(html); // UK postcode pattern
        if (hasPhone && hasAddress) {
          geoScore += 4;
          findings.push({ label: 'Contact Details (NAP)', detail: 'Phone number and address found on the page. AI tools use these to verify and recommend local businesses.', status: 'pass' });
        } else if (hasPhone || hasAddress) {
          geoScore += 2;
          findings.push({ label: 'Contact Details (NAP)', detail: hasPhone ? 'Phone found but no visible address/postcode.' : 'Address found but no visible phone number.', status: 'warning' });
        } else {
          findings.push({ label: 'Contact Details (NAP)', detail: 'No phone number or address found on the page. AI tools need these to recommend local businesses.', status: 'fail' });
        }

        // Business name prominence (3pts)
        const businessLower = businessName.toLowerCase();
        const businessMentions = (htmlLower.split(businessLower).length - 1);
        if (businessMentions >= 3) {
          geoScore += 3;
          findings.push({ label: 'Business Name Visibility', detail: 'Your business name appears ' + businessMentions + ' times on the page.', status: 'pass' });
        } else if (businessMentions >= 1) {
          geoScore += 2;
          findings.push({ label: 'Business Name Visibility', detail: 'Your business name only appears ' + businessMentions + ' time(s). More mentions help AI tools associate your name with your services.', status: 'warning' });
        } else {
          findings.push({ label: 'Business Name Visibility', detail: 'Your business name doesn\'t appear on the page. AI tools can\'t recommend what they can\'t identify.', status: 'fail' });
        }

        // Trade/service mentions (2pts)
        const tradeLower = trade.toLowerCase();
        const tradeMentions = (htmlLower.split(tradeLower).length - 1);
        if (tradeMentions >= 3) {
          geoScore += 2;
        } else if (tradeMentions >= 1) {
          geoScore += 1;
        }

        // Robots.txt AI crawler check (5pts)
        try {
          const siteUrl = website.startsWith('http') ? website : 'https://' + website;
          const urlObj = new URL(siteUrl);
          const robotsUrl = urlObj.origin + '/robots.txt';
          const robotsController = new AbortController();
          const robotsTimeout = setTimeout(() => robotsController.abort(), 5000);

          const robotsResp = await fetch(robotsUrl, {
            headers: { 'User-Agent': 'FastGEO-Scanner/1.0' },
            signal: robotsController.signal,
            redirect: 'follow'
          });
          clearTimeout(robotsTimeout);

          if (robotsResp.ok) {
            const robotsTxt = await robotsResp.text();
            const robotsLower = robotsTxt.toLowerCase();
            const aiCrawlers = ['gptbot', 'claudebot', 'perplexitybot', 'chatgpt-user', 'anthropic-ai'];
            // Parse robots.txt properly — only flag as blocked if Disallow: / is set
            const lines = robotsLower.split('\n');
            let currentAgent = '';
            let blocked = false;
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith('user-agent:')) {
                currentAgent = trimmed.replace('user-agent:', '').trim();
              } else if (trimmed.startsWith('disallow:') && trimmed.replace('disallow:', '').trim() === '/') {
                if (currentAgent === '*' || aiCrawlers.some(bot => currentAgent.includes(bot))) {
                  blocked = true;
                }
              }
            }

            if (!blocked) {
              geoScore += 5;
              findings.push({ label: 'AI Crawlers Allowed', detail: 'Your robots.txt allows AI tools to read your website.', status: 'pass' });
            } else {
              findings.push({ label: 'AI Crawlers Blocked', detail: 'Your robots.txt is blocking AI tools like GPTBot and ClaudeBot from reading your site. This means they literally cannot find or recommend you.', status: 'fail' });
            }
          } else {
            geoScore += 3;
            findings.push({ label: 'Robots.txt Check', detail: 'Could not check robots.txt. Make sure AI crawlers aren\'t blocked.', status: 'warning' });
          }
        } catch (e) {
          geoScore += 3;
          findings.push({ label: 'Robots.txt Check', detail: 'Could not check robots.txt. Make sure AI crawlers aren\'t blocked.', status: 'warning' });
        }

        // Third party / external signals check (7pts)
        const externalPlatforms = [
          'trustpilot', 'checkatrade', 'mybuilder', 'bark',
          'google.com/maps', 'google.com/business', 'yell.com',
          'facebook.com', 'linkedin.com', 'yelp', 'freeindex'
        ];
        const foundPlatforms = externalPlatforms.filter(p => htmlLower.includes(p));
        const platformCount = foundPlatforms.length;

        if (platformCount >= 4) {
          geoScore += 7;
          findings.push({ label: 'External Presence', detail: 'Strong external presence — linked to ' + platformCount + ' directory/review platforms.', status: 'pass' });
        } else if (platformCount >= 2) {
          geoScore += 4;
          findings.push({ label: 'External Presence', detail: 'Some external links found (' + platformCount + ' platforms). More directory listings = more third party signals for AI.', status: 'warning' });
        } else if (platformCount === 1) {
          geoScore += 2;
          findings.push({ label: 'External Presence', detail: 'Only 1 external platform link found. More directory listings = more third party signals for AI.', status: 'warning' });
        } else {
          findings.push({ label: 'External Presence', detail: 'No links to directories, review sites, or business profiles found. 68% of AI citations come from third party sources — this is your biggest gap.', status: 'fail' });
        }

        // ── CONTENT QUALITY (out of 25) ──

        // Strip tags for content analysis
        pageText = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                       .replace(/<[^>]+>/g, ' ')
                       .replace(/\s+/g, ' ')
                       .trim();

        const wordCount = pageText.split(/\s+/).length;

        if (wordCount > 800) {
          contentScore += 8;
          findings.push({ label: 'Content Depth', detail: 'Good amount of content (' + wordCount + ' words). AI tools prefer detailed, informative pages.', status: 'pass' });
        } else if (wordCount > 300) {
          contentScore += 4;
          findings.push({ label: 'Content Depth', detail: 'Moderate content (' + wordCount + ' words). Aim for 800+ words on key pages for better AI visibility.', status: 'warning' });
        } else {
          contentScore += 1;
          findings.push({ label: 'Content Depth', detail: 'Very thin content (' + wordCount + ' words). AI tools skip thin pages. Add detailed service descriptions, FAQs, and about information.', status: 'fail' });
        }

        // Reviews/testimonials
        const hasReviews = htmlLower.includes('review') || htmlLower.includes('testimonial') || htmlLower.includes('feedback') || htmlLower.includes('★') || htmlLower.includes('star');
        if (hasReviews) {
          contentScore += 7;
          findings.push({ label: 'Social Proof', detail: 'Reviews or testimonials found. These are trust signals AI tools look for.', status: 'pass' });
        } else {
          findings.push({ label: 'Social Proof', detail: 'No reviews or testimonials visible. Adding customer feedback increases your credibility with AI tools.', status: 'fail' });
        }

        // Location mentions
        const cityLower = city.toLowerCase();
        const cityMentions = (htmlLower.split(cityLower).length - 1);
        if (cityMentions >= 2) {
          contentScore += 5;
          findings.push({ label: 'Location Signals', detail: '"' + city + '" mentioned ' + cityMentions + ' times. Good local relevance.', status: 'pass' });
        } else if (cityMentions >= 1) {
          contentScore += 3;
          findings.push({ label: 'Location Signals', detail: '"' + city + '" mentioned once. Add more location references to strengthen local visibility.', status: 'warning' });
        } else {
          findings.push({ label: 'Location Signals', detail: '"' + city + '" not found on the page. AI tools need location signals to recommend you for local searches.', status: 'fail' });
        }

        // FAQ section
        const hasFAQ = htmlLower.includes('faq') || htmlLower.includes('frequently asked') || htmlLower.includes('common question');
        if (hasFAQ) {
          contentScore += 5;
          findings.push({ label: 'FAQ Section', detail: 'FAQ content found. AI tools love question and answer formats.', status: 'pass' });
        } else {
          findings.push({ label: 'FAQ Section', detail: 'No FAQ section found. Adding common questions and answers is one of the best ways to get cited by AI.', status: 'fail' });
        }

        // ── TECHNICAL (out of 25) ──

        // Mobile viewport
        if (htmlLower.includes('viewport')) {
          technicalScore += 5;
        } else {
          findings.push({ label: 'Mobile Friendly', detail: 'No mobile viewport tag found. Your site may not display properly on phones.', status: 'fail' });
        }

        // Open Graph tags
        if (htmlLower.includes('og:title') || htmlLower.includes('og:description')) {
          technicalScore += 5;
          findings.push({ label: 'Social Meta Tags', detail: 'Open Graph tags found. Good for social sharing and AI context.', status: 'pass' });
        } else {
          findings.push({ label: 'Social Meta Tags', detail: 'No Open Graph meta tags. These help AI tools and social platforms understand your page.', status: 'warning' });
        }

        // Sitemap reference
        if (htmlLower.includes('sitemap')) {
          technicalScore += 5;
        }

        // Robots meta
        const robotsBlock = htmlLower.includes('noindex');
        if (robotsBlock) {
          findings.push({ label: 'Indexing Blocked', detail: 'Your page has a noindex tag — search engines and AI tools are being told not to read it!', status: 'fail' });
        } else {
          technicalScore += 5;
        }

        // Alt tags on images
        const imgCount = (html.match(/<img/gi) || []).length;
        const altCount = (html.match(/<img[^>]*alt=["'][^"']+["']/gi) || []).length;
        if (imgCount > 0) {
          if (altCount >= imgCount * 0.7) {
            technicalScore += 5;
            findings.push({ label: 'Image Alt Tags', detail: altCount + ' of ' + imgCount + ' images have alt text. Good accessibility and SEO.', status: 'pass' });
          } else {
            technicalScore += 2;
            findings.push({ label: 'Image Alt Tags', detail: 'Only ' + altCount + ' of ' + imgCount + ' images have alt text. Add descriptive alt tags to all images.', status: 'warning' });
          }
        }
      }

    } else {
      // ── NO WEBSITE PROVIDED ──
      findings.push({ label: 'No Website', detail: 'You don\'t have a website yet. This is actually your biggest opportunity — when we build your site, we build it AI-ready from day one.', status: 'warning' });

      // Give baseline scores for a business without a website
      seoScore = 0;
      geoScore = 0;
      contentScore = 0;
      technicalScore = 0;
    }

    // ── Calculate total score ──
    // Cap each category at its max
    seoScore = Math.min(seoScore, 25);
    geoScore = Math.min(geoScore, 25);
    contentScore = Math.min(contentScore, 25);
    technicalScore = Math.min(technicalScore, 25);
    const totalScore = seoScore + geoScore + contentScore + technicalScore;

    // ── Generate quick win with Claude Haiku (if API key available) ──
    let quickWin = '';
    let summary = '';

    if (ANTHROPIC_API_KEY) {
      try {
        const topIssues = findings.filter(f => f.status === 'fail').slice(0, 3).map(f => f.label + ': ' + f.detail).join('\n');

        const prompt = `You are a GEO (Generative Engine Optimization) expert. A ${trade} business called "${businessName}" in ${city} just scored ${totalScore}/100 on their AI & SEO readiness check.${hasWebsite ? '' : ' They don\'t have a website yet.'}

Their biggest issues:
${topIssues || 'No major issues found.'}

Write two things:
1. QUICK_WIN: One specific, actionable thing they can do TODAY to improve their score. Be concrete and specific to their trade. Max 2 sentences.
2. SUMMARY: A one-sentence summary of their overall AI & SEO readiness. Be direct and honest but encouraging.

Format your response exactly like:
QUICK_WIN: [your quick win here]
SUMMARY: [your summary here]`;

        const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: prompt }]
          })
        });

        if (claudeResp.ok) {
          const claudeData = await claudeResp.json();
          const text = claudeData.content[0].text;

          const qwMatch = text.match(/QUICK_WIN:\s*(.*?)(?=SUMMARY:|$)/s);
          const sumMatch = text.match(/SUMMARY:\s*(.*?)$/s);

          if (qwMatch) quickWin = qwMatch[1].trim();
          if (sumMatch) summary = sumMatch[1].trim();
        }
      } catch (e) {
        console.error('Claude API error:', e);
      }
    }

    // Fallback if no AI response
    if (!quickWin) {
      if (!hasWebsite) {
        quickWin = 'Your first step is getting a website live. Even a simple one-page site with your business name, services, location, and contact details gives AI tools something to find and recommend.';
      } else {
        const topFail = findings.find(f => f.status === 'fail');
        quickWin = topFail
          ? 'Fix this first: ' + topFail.detail
          : 'Your site has solid foundations. Focus on adding more detailed content about your services and gathering customer reviews.';
      }
    }

    if (!summary) {
      if (totalScore <= 25) {
        summary = `${businessName} has significant gaps in SEO and AI readiness. The good news: every fix you make will have a big impact on your visibility.`;
      } else if (totalScore <= 50) {
        summary = `${businessName} has some foundations in place but is missing key signals that AI tools look for when making recommendations.`;
      } else if (totalScore <= 75) {
        summary = `${businessName} is in a solid position. A few targeted improvements would significantly boost your AI search visibility.`;
      } else {
        summary = `${businessName} has strong SEO and AI readiness foundations. Ongoing optimization will keep you ahead of competitors.`;
      }
    }

    return res.status(200).json({
      businessName,
      trade,
      city,
      hasWebsite,
      score: totalScore,
      summary,
      quickWin,
      categories: [
        { name: 'SEO Foundations', score: seoScore, max: 25, note: 'Title, meta description, headings, SSL' },
        { name: 'GEO Readiness', score: geoScore, max: 25, note: 'Schema markup, business details, service signals' },
        { name: 'Content Quality', score: contentScore, max: 25, note: 'Content depth, reviews, location signals, FAQs' },
        { name: 'Technical', score: technicalScore, max: 25, note: 'Mobile, social tags, indexing, image alt tags' }
      ],
      findings,
      email
    });

  } catch (error) {
    console.error('Check API error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
