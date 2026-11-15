// The party palette: every player keeps the same color in every game. Index = player.color.
export const PALETTE = [0xff5a5f, 0x3ea6ff, 0x4cd964, 0xffcc00, 0xb57bff, 0xff8c42, 0x2ee6d6, 0xff6ec7];
export const PALETTE_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Teal', 'Pink'];
export const css = (i) => '#' + PALETTE[((i % 8) + 8) % 8].toString(16).padStart(6, '0');
export const hex = (i) => PALETTE[((i % 8) + 8) % 8];
