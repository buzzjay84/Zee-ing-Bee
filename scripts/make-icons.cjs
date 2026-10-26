const fs = require("node:fs");
const path = require("node:path");
const png2icons = require("png2icons");
const UPNG = require("png2icons/lib/UPNG");
const Resize = require("png2icons/lib/resize3");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "src", "assets", "branding", "zee-ing-bee-logo.png");
const target = path.join(root, "resources", "icons");
const png = fs.readFileSync(source);
fs.mkdirSync(target, { recursive: true });
// Square transparent padding keeps every icon size square without stretching.
const decoded = UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength));
const pixels = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
const side = Math.ceil(Math.max(decoded.width, decoded.height) / 2) * 2;
const square = new Uint8Array(side * side * 4);
const left = Math.floor((side - decoded.width) / 2);
const top = Math.floor((side - decoded.height) / 2);
for (let row = 0; row < decoded.height; row++) square.set(pixels.subarray(row * decoded.width * 4, (row + 1) * decoded.width * 4), ((row + top) * side + left) * 4);
const icon = { width: 1024, height: 1024, data: new Uint8Array(1024 * 1024 * 4) };
Resize.bicubicInterpolation({ width: side, height: side, data: square }, icon);
const iconPng = Buffer.from(UPNG.encode([icon.data.buffer], 1024, 1024, 0));
fs.writeFileSync(path.join(target, "zee-ing-bee.png"), iconPng);
const ico = png2icons.createICO(iconPng, png2icons.BICUBIC, 0, false, true);
const icns = png2icons.createICNS(iconPng, png2icons.BICUBIC, 0);
if (!ico || !icns) throw new Error("Unable to convert the logo into app icons.");
fs.writeFileSync(path.join(target, "zee-ing-bee.ico"), ico);
fs.writeFileSync(path.join(target, "zee-ing-bee.icns"), icns);
console.log("Created Windows ICO and macOS ICNS icons in resources/icons.");
