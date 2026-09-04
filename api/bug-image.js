import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://hbuvzcxhrkneywabmaod.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_M2JvKUmCmgShodNziXNRDw_NwYoN_Rc';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query || {};
  if (!id) {
    return res.status(400).json({ error: 'Missing bug id parameter' });
  }

  try {
    // 1. Try finding in bug_logs
    const { data: bug } = await supabase
      .from('bug_logs')
      .select('image_url')
      .eq('id', id)
      .maybeSingle();

    let imageUrl = bug?.image_url;

    // 2. If not found in bug_logs, check test_runs & archived_runs
    if (!imageUrl) {
      const [runsRes, archivedRes] = await Promise.all([
        supabase.from('test_runs').select('bug_logs'),
        supabase.from('archived_runs').select('bug_logs')
      ]);

      const allRuns = [...(runsRes.data || []), ...(archivedRes.data || [])];
      for (const r of allRuns) {
        if (Array.isArray(r.bug_logs)) {
          const found = r.bug_logs.find(b => b && b.id === id);
          if (found && (found.imageUrl || found.image_url)) {
            imageUrl = found.imageUrl || found.image_url;
            break;
          }
        }
      }
    }

    if (!imageUrl) {
      return res.status(404).json({ error: 'Bug image not found' });
    }

    // 3. If external HTTP/HTTPS URL, redirect directly
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      return res.redirect(302, imageUrl);
    }

    // 4. If Base64 Data URL, decode and serve as binary image
    const dataUrlMatch = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrlMatch) {
      const contentType = dataUrlMatch[1] || 'image/jpeg';
      const base64Data = dataUrlMatch[2];
      const buffer = Buffer.from(base64Data, 'base64');

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

      if (req.method === 'HEAD') {
        return res.status(200).end();
      }

      return res.status(200).send(buffer);
    }

    return res.status(400).json({ error: 'Unsupported image URL format' });
  } catch (err) {
    console.error('Error serving bug image:', err);
    return res.status(500).json({ error: 'Internal server error serving bug image' });
  }
}
