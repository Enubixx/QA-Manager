export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { scriptUrl, bugs } = req.body || {};
    const targetUrl = scriptUrl || 'https://script.google.com/a/macros/google.com/s/AKfycbzMH5O3zxz5mHQrQzH5gqc62jssceuXszuKxxRmnHMuj4Pq0AyEVRzrrv_OUrM7B5GlsA/exec';

    if (!bugs || !Array.isArray(bugs) || bugs.length === 0) {
      return res.status(400).json({ error: 'No bugs provided to sync' });
    }

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bugs }),
      redirect: 'follow'
    });

    const responseText = await response.text();
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (e) {
      jsonResponse = { raw: responseText };
    }

    return res.status(200).json({
      status: 'success',
      statusCode: response.status,
      result: jsonResponse
    });
  } catch (err) {
    console.error('Error forwarding bug sync to Google Sheets:', err);
    return res.status(500).json({
      error: 'Failed to sync to Google Sheet',
      message: err.message
    });
  }
}
