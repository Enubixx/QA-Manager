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
    const defaultUrl = 'https://script.google.com/a/macros/google.com/s/AKfycbzMH5O3zxz5mHQrQzH5gqc62jssceuXszuKxxRmnHMuj4Pq0AyEVRzrrv_OUrM7B5GlsA/exec';
    const targetUrl = typeof scriptUrl === 'string' && scriptUrl.trim() ? scriptUrl.trim() : defaultUrl;

    // Validate targetUrl against SSRF: only allow official Google Apps Script domains over HTTPS
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (urlErr) {
      return res.status(400).json({ status: 'error', error: 'Invalid Google Apps Script URL' });
    }
    const allowedHosts = new Set(['script.google.com', 'script.googleusercontent.com']);
    if (parsedUrl.protocol !== 'https:' || !allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
      return res.status(400).json({
        status: 'error',
        error: 'Only https://script.google.com/ Web App URLs are permitted',
      });
    }

    if (!bugs || !Array.isArray(bugs) || bugs.length === 0) {
      return res.status(400).json({ status: 'error', error: 'No bugs provided to sync' });
    }

    const response = await fetch(parsedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bugs }),
      redirect: 'follow'
    });

    const responseText = await response.text();
    if (responseText.includes('Sign in - Google Accounts') || responseText.includes('AccountChooser')) {
      return res.status(401).json({
        status: 'auth_required',
        error: 'Google Workspace domain login required',
        message: 'Google requires domain authentication. Syncing directly via your browser session.'
      });
    }

    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseText);
    } catch (e) {
      jsonResponse = { raw: responseText };
    }

    if (!response.ok || jsonResponse?.status === 'error') {
      const errMsg = jsonResponse?.message || jsonResponse?.error || `Google Apps Script returned HTTP ${response.status}`;
      return res.status(response.ok ? 502 : response.status).json({
        status: 'error',
        statusCode: response.status,
        error: errMsg,
        message: errMsg,
        result: jsonResponse,
      });
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
