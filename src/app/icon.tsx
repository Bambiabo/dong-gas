import { ImageResponse } from 'next/og';
export const size = { width: 512, height: 512 };
export const contentType = 'image/png';
export default function Icon() {
  return new ImageResponse(<div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#071525' }}><svg width='340' height='340' viewBox='0 0 340 340'><circle cx='170' cy='170' r='150' fill='none' stroke='#D6AB58' strokeWidth='5'/><path d='M178 52 C205 109 266 137 248 205 C235 255 194 281 151 269 C102 256 79 214 94 172 C104 146 123 129 136 103 C133 147 150 153 158 165 C181 136 188 101 178 52Z' fill='#EBC778'/><path d='M175 166 C190 191 213 204 200 231 C190 252 161 258 145 239 C127 219 146 196 156 184 C155 204 165 207 170 213 C180 197 180 183 175 166Z' fill='#071525'/></svg></div>, size);
}
