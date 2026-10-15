/**
 * Buganizer catalog for the QA Manager Buganizer triage view.
 *
 * Components are every component used in the Press QA (8810391) and Gentle Monster (8682925)
 * hotlists as of Oct 14, 2026, sorted by how often the team used them. The CUJ defaults come
 * from that analysis (AI Camera -> User Feedback confirmed by the team).
 */
export interface BuganizerComponent { id: string; name: string; path: string; uses: number }

export const BUGANIZER_COMPONENTS: BuganizerComponent[] = [
  {
    "id": "1755964",
    "name": "Gemini_on_glasses",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses",
    "uses": 169
  },
  {
    "id": "2175013",
    "name": "Tools",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > Tools",
    "uses": 76
  },
  {
    "id": "1691487",
    "name": "Translate Triage",
    "path": "XR > Experiences & APIs > Glasses Apps > Translate & Transcribe > Translate Triage",
    "uses": 52
  },
  {
    "id": "2177524",
    "name": "Dynamic-Camera",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > Dynamic-Camera",
    "uses": 37
  },
  {
    "id": "2019123",
    "name": "AI Camera",
    "path": "XR > Core Tech > AI Camera",
    "uses": 31
  },
  {
    "id": "2191225",
    "name": "Retails on Glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Retails on Glasses",
    "uses": 24
  },
  {
    "id": "1948751",
    "name": "Demos",
    "path": "XR > Services > Demos",
    "uses": 17
  },
  {
    "id": "1816434",
    "name": "GL_Triage",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > GL_Triage",
    "uses": 16
  },
  {
    "id": "1210075",
    "name": "Triage - Geo",
    "path": "XR > Experiences & APIs > Glasses Apps > Geospatial // Maps > Maps on Glasses > Triage - Geo",
    "uses": 10
  },
  {
    "id": "1662420",
    "name": "Glasses",
    "path": "Knowledge & Information > Gemini > Core Experience > Devices > Glasses",
    "uses": 9
  },
  {
    "id": "1363058",
    "name": "Frameworks",
    "path": "XR > Glasses > OS > Glasses OS > microXR > Frameworks",
    "uses": 9
  },
  {
    "id": "1687179",
    "name": "Translate & Transcribe",
    "path": "XR > Experiences & APIs > Glasses Apps > Translate & Transcribe",
    "uses": 9
  },
  {
    "id": "1173669",
    "name": "Maps on Glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Geospatial // Maps > Maps on Glasses",
    "uses": 7
  },
  {
    "id": "2014150",
    "name": "AI Camera Backend",
    "path": "XR > Services > Backends > AI Camera Backend",
    "uses": 6
  },
  {
    "id": "1088187",
    "name": "Photography",
    "path": "XR > Experiences & APIs > Glasses Apps > Photography",
    "uses": 5
  },
  {
    "id": "1873200",
    "name": "Audio",
    "path": "XR > Glasses > OS > Glasses OS > microXR > Audio",
    "uses": 5
  },
  {
    "id": "2256987",
    "name": "User Feedback",
    "path": "XR > Core Tech > AI Camera > User Feedback",
    "uses": 4
  },
  {
    "id": "1814396",
    "name": "Connectivity",
    "path": "XR > Services > Split Compute > Split Compute > Core > Connectivity",
    "uses": 4
  },
  {
    "id": "1633652",
    "name": "SW",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW",
    "uses": 4
  },
  {
    "id": "1902923",
    "name": "Gemini Live",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > Gemini Live",
    "uses": 4
  },
  {
    "id": "977759",
    "name": "Triage Split Compute",
    "path": "XR > Services > Split Compute > Triage Split Compute",
    "uses": 4
  },
  {
    "id": "1904283",
    "name": "Glasses Inputs Triage",
    "path": "XR > Experiences & APIs > Glasses Input > Glasses Inputs Triage",
    "uses": 4
  },
  {
    "id": "1919897",
    "name": "Triage - Meet-on-glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Meet on Glasses > Triage - Meet-on-glasses",
    "uses": 3
  },
  {
    "id": "1758486",
    "name": "Android_Gemini_Client",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > Android_Gemini_Client",
    "uses": 3
  },
  {
    "id": "1957705",
    "name": "Triage (1P Android Companion)",
    "path": "XR > Experiences & APIs > Companion App > 1P Android Companion > Triage (1P Android Companion)",
    "uses": 3
  },
  {
    "id": "1114885",
    "name": "Triage",
    "path": "XR > Experiences & APIs > Glasses Apps > Photography > Triage",
    "uses": 3
  },
  {
    "id": "1909749",
    "name": "Bugs",
    "path": "Research > 1316677 > 1351549 > Translation > Bugs",
    "uses": 3
  },
  {
    "id": "2160593",
    "name": "Gemini",
    "path": "XR > Experiences & APIs > Glasses Apps > Geospatial // Maps > Maps on Glasses > Gemini",
    "uses": 2
  },
  {
    "id": "1149524",
    "name": "Android Notifications",
    "path": "XR > Experiences & APIs > Glasses System UI > Android Notifications",
    "uses": 2
  },
  {
    "id": "1813707",
    "name": "Meet on Glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Meet on Glasses",
    "uses": 2
  },
  {
    "id": "1994573",
    "name": "microXR",
    "path": "XR > Core Tech > XR Camera Systems > microXR",
    "uses": 2
  },
  {
    "id": "1935464",
    "name": "Audio",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > Audio",
    "uses": 2
  },
  {
    "id": "1691490",
    "name": "Triage: Media on Audio Glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Media on Audio Glasses > Triage: Media on Audio Glasses",
    "uses": 2
  },
  {
    "id": "1946871",
    "name": "Demo Issues",
    "path": "XR > Tech Support > Demos Support > Demo Issues",
    "uses": 2
  },
  {
    "id": "1946819",
    "name": "Inputs",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > Inputs",
    "uses": 2
  },
  {
    "id": "1750090",
    "name": "Camera",
    "path": "XR > Glasses > OS > Glasses OS > System SW > Camera",
    "uses": 2
  },
  {
    "id": "1865601",
    "name": "Hotword",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > Hotword",
    "uses": 1
  },
  {
    "id": "1750220",
    "name": "Audio",
    "path": "XR > Glasses > OS > Glasses OS > System SW > Audio",
    "uses": 1
  },
  {
    "id": "2037470",
    "name": "Don Doff Detection",
    "path": "XR > Core Tech > Don Doff Detection",
    "uses": 1
  },
  {
    "id": "1868699",
    "name": "microXR-fw",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > microXR-fw",
    "uses": 1
  },
  {
    "id": "1266290",
    "name": "LocNav",
    "path": "XR > Core Tech > Head Tracking > LocNav",
    "uses": 1
  },
  {
    "id": "1814499",
    "name": "Camera",
    "path": "XR > Services > Split Compute > Split Compute > Core > Camera",
    "uses": 1
  },
  {
    "id": "1835752",
    "name": "AI for XR Developers",
    "path": "XR > Glasses > Glasses DevEx > AI for XR Developers",
    "uses": 1
  },
  {
    "id": "1908347",
    "name": "Core",
    "path": "Knowledge & Information > Gemini > Core Experience > Live > Conversation Mode > Core",
    "uses": 1
  },
  {
    "id": "2117456",
    "name": "Triage - Don/Doff",
    "path": "XR > Core Tech > Don Doff Detection > Triage - Don/Doff",
    "uses": 1
  },
  {
    "id": "1687295",
    "name": "Media on Audio Glasses",
    "path": "XR > Experiences & APIs > Glasses Apps > Media on Audio Glasses",
    "uses": 1
  },
  {
    "id": "1958009",
    "name": "Triage (Android Notifications)",
    "path": "XR > Experiences & APIs > Glasses System UI > Android Notifications > Triage (Android Notifications)",
    "uses": 1
  },
  {
    "id": "2077339",
    "name": "Voice",
    "path": "Knowledge & Information > Gemini > Core Experience > Live > Voice",
    "uses": 1
  },
  {
    "id": "1900397",
    "name": "1P Android Companion",
    "path": "XR > Experiences & APIs > Companion App > 1P Android Companion",
    "uses": 1
  },
  {
    "id": "1837004",
    "name": "Core Experience",
    "path": "Knowledge & Information > Gemini > Core Experience",
    "uses": 1
  },
  {
    "id": "926807",
    "name": "Core",
    "path": "XR > Services > Split Compute > Split Compute > Core",
    "uses": 1
  },
  {
    "id": "1948749",
    "name": "Triage",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > System UI > Triage",
    "uses": 1
  },
  {
    "id": "1866682",
    "name": "iOS_Gemini Client",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > iOS_Gemini Client",
    "uses": 1
  },
  {
    "id": "2060844",
    "name": "AutoZoom Triage",
    "path": "XR > Core Tech > Semantic > Astra / Gemini Live > AutoZoom Triage",
    "uses": 1
  },
  {
    "id": "1814241",
    "name": "Input",
    "path": "XR > Services > Split Compute > Split Compute > Core > Input",
    "uses": 1
  },
  {
    "id": "2155653",
    "name": "Projection Client Capture",
    "path": "XR > Glasses > OS > Glasses OS > microXR > Frameworks > Projection Client Capture",
    "uses": 1
  },
  {
    "id": "1814500",
    "name": "App Model",
    "path": "XR > Services > Split Compute > Split Compute > Core > App Model",
    "uses": 1
  },
  {
    "id": "2032195",
    "name": "gl_alpha_agsa_triage",
    "path": "XR > Experiences & APIs > AI Agent > Gemini_on_glasses > GL_Triage > gl_alpha_agsa_triage",
    "uses": 1
  },
  {
    "id": "1827056",
    "name": "Experiences",
    "path": "Android > Partner > External > Samsung > Handheld > Special Collaborations > HaeAn > SW > Experiences",
    "uses": 1
  },
  {
    "id": "1363016",
    "name": "Connectivity",
    "path": "XR > Glasses > OS > Glasses OS > microXR > Connectivity",
    "uses": 1
  }
];

/** How many of the most-used components to show before the "search all" list. */
export const TOP_COMPONENT_COUNT = 15;

/** Default component per QA app CUJ (feature name, matched case-insensitively). */
export const CUJ_DEFAULT_COMPONENT: Record<string, string> = {
  'Gemini Live (Verbal)': '1755964',
  'Gemini Live (Multimodal)': '1755964',
  'Google Keep': '2175013',
  'Google Calendar': '2175013',
  'YouTube Music': '2175013',
  'Spotify': '2175013',
  'Google Home': '2175013',
  'Music Playback (Multimodal)': '2175013',
  'Instacart': '2175013',
  'AI Camera': '2256987',
  'Google Translate (Speech To Speech)': '1691487',
  'Gemini Live Translation (Text To Speech)': '1691487',
  'Google Maps': '1210075',
  'Google Meet': '1919897',
  'Text & Spoken Notifications': '1958009',
  'Photo Capture': '1088187',
  'Video Capture': '1088187',
  'Thwart Detection': '1363058',
};

/** Fallback component when a CUJ has no default. */
export const FALLBACK_COMPONENT_ID = '1755964';

/** Hotlist per test plan (same allowlist the RX95 bridge uses). */
export const PLAN_HOTLISTS: Record<string, { hotlistId: string; name: string }> = {
  'plan-1787946982095': { hotlistId: '8810391', name: 'NYFW Press Demo Bugs' },
  'plan-1791908761906': { hotlistId: '8682925', name: 'Jinju Launch Event' },
};

export const BUGANIZER_PRIORITIES = ['P0', 'P1', 'P2', 'P3', 'P4'] as const;
export const BUGANIZER_SEVERITIES = ['', 'S0', 'S1', 'S2', 'S3', 'S4'] as const;
export const BUGANIZER_TYPES = [
  { value: 'BUG', label: 'Bug' },
  { value: 'FEATURE_REQUEST', label: 'Feature request' },
  { value: 'CUSTOMER_ISSUE', label: 'Customer issue' },
  { value: 'INTERNAL_CLEANUP', label: 'Internal cleanup' },
  { value: 'PROCESS', label: 'Process' },
] as const;

export const componentById = (id: string): BuganizerComponent | undefined =>
  BUGANIZER_COMPONENTS.find(c => c.id === id);
