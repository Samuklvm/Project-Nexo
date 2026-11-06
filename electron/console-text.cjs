/*
 * Saída de programas de console do Windows (powercfg, sc…): quando redirecionada, vem na página de código OEM do
 * console (850 no Windows em português), não em UTF-8. Lida como UTF-8, "Máximo" virava "M�ximo".
 * decodeConsole(bytes): usa UTF-8 se os bytes forem UTF-8 válido; senão, decodifica como CP850.
 */
const CP850_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';

function decodeConsole(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes ?? ''), 'latin1');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { /* não é UTF-8 */ }
  let out = '';
  for (const byte of buffer) out += byte < 0x80 ? String.fromCharCode(byte) : CP850_HIGH[byte - 0x80];
  return out;
}

module.exports = { decodeConsole, CP850_HIGH };
