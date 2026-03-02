function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  return {
    r: parseInt(hex.substring(0, 2), 16) / 255,
    g: parseInt(hex.substring(2, 4), 16) / 255,
    b: parseInt(hex.substring(4, 6), 16) / 255
  };
}

function linearize(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(h1, h2) {
  const l1 = luminance(h1);
  const l2 = luminance(h2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function rgbToHex(r, g, b) {
  const toHex = (c) => {
    const val = Math.round(Math.min(255, Math.max(0, c * 255)));
    return val.toString(16).padStart(2, '0');
  };
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function findFixedColor(fg, bg, targetRatio) {
  const fgRgb = hexToRgb(fg);
  for (let step = 0; step <= 255; step++) {
    const factor = step / 255;
    const dr = Math.max(0, fgRgb.r - factor);
    const dg = Math.max(0, fgRgb.g - factor);
    const db = Math.max(0, fgRgb.b - factor);
    const darkHex = rgbToHex(dr, dg, db);
    if (contrastRatio(darkHex, bg) >= targetRatio) return darkHex;
    const lr = Math.min(1, fgRgb.r + factor);
    const lg = Math.min(1, fgRgb.g + factor);
    const lb = Math.min(1, fgRgb.b + factor);
    const lightHex = rgbToHex(lr, lg, lb);
    if (contrastRatio(lightHex, bg) >= targetRatio) return lightHex;
  }
  return null;
}

const pairings = [
  {name:'L: Main text on white',fg:'#111111',bg:'#FFFFFF'},
 {name:'L: Main text on surface',fg:'#111111',bg:'#FFFEFB'},
 {name:'L: Muted text on white',fg:'#6B7B72',bg:'#FFFFFF'},
 {name:'L: Muted text on surface',fg:'#6B7B72',bg:'#FFFEFB'},
 {name:'L: Secondary text on white',fg:'#607d8b',bg:'#FFFFFF'},
 {name:'L: Light text on white',fg:'#9CA8A0',bg:'#FFFFFF'},
 {name:'L: Placeholder text on white',fg:'#94a3b8',bg:'#FFFFFF'},
 {name:'L: Empty cell text on white',fg:'#cbd5e1',bg:'#FFFFFF'},
 {name:'L: No-data text on white',fg:'#64748b',bg:'#FFFFFF'},
 {name:'L: White on table header green',fg:'#FFFFFF',bg:'#3B6AC5'},
 {name:'L: White on table header teal',fg:'#FFFFFF',bg:'#5B84D6'},
 {name:'L: White on total header dark',fg:'#FFFFFF',bg:'#2F5499'},
 {name:'L: White on day cell gradient start',fg:'#FFFFFF',bg:'#3B6AC5'},
 {name:'L: White on day cell gradient end',fg:'#FFFFFF',bg:'#2F5499'},
 {name:'L: Usage stat value',fg:'#059669',bg:'#FFFFFF'},
 {name:'L: Hours stat value',fg:'#4f46e5',bg:'#FFFFFF'},
 {name:'L: Teachers stat value',fg:'#d97706',bg:'#FFFFFF'},
 {name:'L: Subjects stat value',fg:'#db2777',bg:'#FFFFFF'},
 {name:'L: Stat label text',fg:'#607d8b',bg:'#FFFFFF'},
 {name:'L: Subject-0 blue',fg:'#1565c0',bg:'#e3f2fd'},
 {name:'L: Subject-1 orange',fg:'#e65100',bg:'#fff3e0'},
 {name:'L: Subject-2 green',fg:'#2e7d32',bg:'#e8f5e9'},
 {name:'L: Subject-3 red',fg:'#c62828',bg:'#fce4ec'},
 {name:'L: Subject-4 purple',fg:'#6a1b9a',bg:'#f3e5f5'},
 {name:'L: Subject-5 teal',fg:'#00695c',bg:'#e0f7fa'},
 {name:'L: Subject-6 amber',fg:'#f57f17',bg:'#fff8e1'},
 {name:'L: Subject-7 brown',fg:'#4e342e',bg:'#efebe9'},
 {name:'L: Subject-8 indigo',fg:'#283593',bg:'#e8eaf6'},
 {name:'L: Subject-9 lime',fg:'#33691e',bg:'#f1f8e9'},
 {name:'L: Subject-10 deep-orange',fg:'#bf360c',bg:'#fbe9e7'},
 {name:'L: Subject-11 light-blue',fg:'#01579b',bg:'#e1f5fe'},
 {name:'L: Subject-12 yellow',fg:'#827717',bg:'#f9fbe7'},
 {name:'L: Subject-13 deep-purple',fg:'#4527a0',bg:'#ede7f6'},
 {name:'L: Subject-14 dark-teal',fg:'#004d40',bg:'#e0f2f1'},
 {name:'L: Palette-0 Blue',fg:'#1e40af',bg:'#dbeafe'},
 {name:'L: Palette-1 Pink',fg:'#9d174d',bg:'#fce7f3'},
 {name:'L: Palette-2 Amber',fg:'#92400e',bg:'#fef3c7'},
 {name:'L: Palette-3 Indigo',fg:'#4338ca',bg:'#e0e7ff'},
 {name:'L: Palette-4 Teal',fg:'#115e59',bg:'#ccfbf1'},
 {name:'L: Palette-5 Red',fg:'#991b1b',bg:'#fee2e2'},
 {name:'L: Palette-6 Purple',fg:'#7c3aed',bg:'#f3e8ff'},
 {name:'L: Palette-7 Cyan',fg:'#155e75',bg:'#cffafe'},
 {name:'L: Palette-8 Green',fg:'#166534',bg:'#dcfce7'},
 {name:'L: Palette-9 Yellow',fg:'#854d0e',bg:'#fef9c3'},
 {name:'L: Palette-10 Rose',fg:'#be123c',bg:'#ffe4e6'},
 {name:'L: Palette-11 Emerald',fg:'#047857',bg:'#d1fae5'},
 {name:'L: Palette-12 Violet',fg:'#5b21b6',bg:'#c7d2fe'},
 {name:'L: Palette-13 Fuchsia',fg:'#86198f',bg:'#fae8ff'},
 {name:'L: Palette-14 Lime',fg:'#3f6212',bg:'#ecfccb'},
 {name:'L: Palette-15 Orange',fg:'#9a3412',bg:'#fed7aa'},
 {name:'L: Palette-16 Sky',fg:'#075985',bg:'#bae6fd'},
 {name:'L: Palette-17 Lt Rose',fg:'#9f1239',bg:'#fda4af'},
 {name:'L: Palette-18 Lt Cyan',fg:'#0e7490',bg:'#a5f3fc'},
 {name:'L: Palette-19 Lt Green',fg:'#15803d',bg:'#bbf7d0'},
 {name:'L: Room info title',fg:'#111111',bg:'#F4F7F5'},
 {name:'L: Room info muted',fg:'#6B7B72',bg:'#F4F7F5'},
 {name:'L: White on usage badge green',fg:'#FFFFFF',bg:'#059669'},
 {name:'L: White on total hours badge',fg:'#FFFFFF',bg:'#5B84D6'},
 {name:'L: White on btn-primary green',fg:'#FFFFFF',bg:'#3B6AC5'},
 {name:'L: White on btn-success',fg:'#FFFFFF',bg:'#059669'},
 {name:'L: White on btn-warning',fg:'#FFFFFF',bg:'#f59e0b'},
 {name:'L: White on btn-danger',fg:'#FFFFFF',bg:'#ef4444'},
 {name:'L: Primary text on surface',fg:'#3B6AC5',bg:'#FFFEFB'},
 {name:'L: Activity subject text',fg:'#3B6AC5',bg:'#FFFFFF'},
 {name:'L: Activity room text',fg:'#6B7B72',bg:'#FFFFFF'},
 {name:'L: Period cell text',fg:'#3B6AC5',bg:'#F2F2F2'},
 {name:'L: Edit warning text',fg:'#92400e',bg:'#fff8f0'},
 {name:'L: Validation warning text',fg:'#856404',bg:'#fff3cd'},
 {name:'L: Validation error text',fg:'#721c24',bg:'#f8d7da'},
 {name:'L: Change type add',fg:'#065f46',bg:'#d1fae5'},
 {name:'L: Change type edit',fg:'#92400e',bg:'#fef3c7'},
 {name:'L: Change type delete',fg:'#991b1b',bg:'#fee2e2'},
 {name:'L: Group header blue',fg:'#1e40af',bg:'#EBF0FF'},
 {name:'L: Group header green',fg:'#047857',bg:'#ECFDF5'},
];
