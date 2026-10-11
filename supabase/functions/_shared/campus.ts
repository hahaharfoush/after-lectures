// Building and venue names -> campus. A copy of CAMPUS_KEYWORDS in
// pipeline/tags.py; keep the two in step.
const CAMPUSES: [string, RegExp][] = [
  ['White City', /white city|wood lane|msrh|molecular sciences research hub|i-?hub|translation (and|&) innovation hub|michael uren|scale space/],
  ['Hammersmith', /hammersmith|du cane|commonwealth building|ictem|burlington danes/],
  ['Charing Cross', /charing cross|reynolds|fulham palace road/],
  ["St Mary's", /st\.? mary'?s|paddington|norfolk place|qeqm/],
  ['Chelsea & Westminster', /chelsea (and|&) westminster|chelwest/],
  ['Silwood Park', /silwood/],
  ['Harlington', /harlington/],
  ['Online', /^online$|\bonline (event|session|talk|webinar)\b|\bon (zoom|teams)\b|\bvia (zoom|teams)\b/],
  ['South Kensington', new RegExp([
    'south ken', 'huxley', 'sherfield', 'salc', 'great hall', 'blyth', '\\bsaf\\b', 'alexander fleming', 'blackett',
    'skempton', '\\brsm\\b', 'royal school of mines', 'bessemer', '\\bbone building', 'roderic hill', 'city (and|&) guilds',
    '\\bcagb\\b', 'electrical (and electronic )?engineering', '\\beee(\\b|\\d)', 'mech(anical)? eng', 'chemistry building',
    'dalby court', "queen'?s lawn", "queen'?s tower", 'abdus salam', 'central library', '\\bbeit\\b', 'metric',
    'fivesixeight', '\\b568\\b', 'h-?bar', 'ħ-bar', 'union dining hall', '\\budh\\b', 'union concert hall', 'read theatre',
    'ethos', "prince'?s gardens", 'southside', 'eastside', 'weeks hall', 'imperial college road', 'exhibition road',
    'faculty building', 'ace extension', 'imperial college union', 'union building', 'activities space', 'lower lounge',
    'hyde park', 'prince consort',
  ].join('|'))],
];

export function campusFor(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    if (!text) continue;
    const low = text.toLowerCase();
    for (const [campus, rx] of CAMPUSES) if (rx.test(low)) return campus;
  }
  return null;
}
