export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { businessName, trade, city, email } = req.body;

  if (!businessName || !trade || !city || !email) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    // Run 3 different query styles in parallel for a thorough check
    const queries = [
      `Can you recommend a good ${trade} in ${city}?`,
      `I'm looking for the best ${trade} in ${city}. Who would you suggest?`,
      `What are the top rated ${trade} businesses in ${city}?`
    ];

    const results = await Promise.all(queries.map(async (query) => {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: query }],
          temperature: 0.3,
          max_tokens: 800
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${err}`);
      }

      const data = await response.json();
      const answer = data.usage
        ? { text: data.choices[0].message.content, tokens: data.usage.total_tokens }
        : { text: data.choices[0].message.content, tokens: 0 };

      return { query, ...answer };
    }));

    // Analyse results — check if the business name appears in any response
    const businessLower = businessName.toLowerCase();
    const mentions = results.map(r => {
      const textLower = r.text.toLowerCase();
      const found = textLower.includes(businessLower);
      return {
        query: r.query,
        response: r.text,
        mentioned: found,
        tokens: r.tokens
      };
    });

    const mentionCount = mentions.filter(m => m.mentioned).length;
    const totalQueries = mentions.length;

    // Extract competitor names mentioned (businesses that aren't the target)
    const allResponses = mentions.map(m => m.response).join('\n');

    // Build the verdict
    let verdict, score, recommendation;

    if (mentionCount === 0) {
      verdict = 'invisible';
      score = 0;
      recommendation = `${businessName} does not appear when AI tools are asked to recommend a ${trade} in ${city}. Your competitors are being recommended instead. This is a significant missed opportunity — AI search traffic converts at 4.4x the rate of traditional Google traffic.`;
    } else if (mentionCount < totalQueries) {
      verdict = 'partial';
      score = Math.round((mentionCount / totalQueries) * 100);
      recommendation = `${businessName} appears in ${mentionCount} out of ${totalQueries} AI queries — that's a start, but inconsistent visibility means you're still losing potential customers to competitors who show up every time.`;
    } else {
      verdict = 'visible';
      score = 100;
      recommendation = `${businessName} is being recommended by AI tools for ${trade} in ${city}. To maintain and strengthen this position, ongoing GEO ensures competitors don't overtake you.`;
    }

    return res.status(200).json({
      businessName,
      trade,
      city,
      verdict,
      score,
      mentionCount,
      totalQueries,
      recommendation,
      results: mentions.map(m => ({
        query: m.query,
        mentioned: m.mentioned,
        response: m.response
      }))
    });

  } catch (error) {
    console.error('Check API error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
