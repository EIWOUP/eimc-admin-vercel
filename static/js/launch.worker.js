// Runs the splash race (launch.js) off the main thread: the app can boot as hard as it likes and the
// car still gets every frame of the display. The page hands over its canvas as an OffscreenCanvas.
import { Race } from "./launch.js";
import { MarkPlayer } from "./mark.js";

// Workers don't see the page's fonts: load Inter for "F1" and the livery, as the page does.
// Straight from the bundled file -- fetching Google's CSS to dig one URL out of it meant the
// splash depended on the network, and on a packaged app that is a visible stutter when offline.
//
// This asked for Inter-800-latin.woff2, which has never existed: Inter is a variable font, so
// vendor_fonts.py keeps one file for every weight and points all eight @font-face rules at it
// (see static/vendor/fonts.css). The request 404'd, load() rejected, the caller swallowed it,
// and the car's livery has quietly been drawn in the fallback sans all along. One file, the
// whole 100-900 axis, which is what `italic 800 ... Inter` on the canvas then asks of it.
const INTER = "/static/vendor/fonts/Inter-400-latin.woff2";

async function inter() {
  if (!self.fonts || typeof FontFace === "undefined") return;
  self.fonts.add(await new FontFace("Inter", `url(${INTER})`, { weight: "100 900" }).load());
}

let race = null, rev = 0, go = false, view = null;
onmessage = async ({ data: m }) => {
  if (m.type === "init") {
    view = m.view;
    if (m.mark) new MarkPlayer(m.mark.canvas, { ...m.mark, onLand: (at) => postMessage({ landed: at }) });   // starts at once
    await Promise.race([inter().catch(() => {}), new Promise((ok) => setTimeout(ok, 350))]);
    race = new Race(m.canvas, m.pace, view, () => postMessage("ready"), () => postMessage("done"));
    race.rev = rev;
    if (go) race.launch();
  } else if (m.type === "view") {
    view = m.view;
    race?.resize(view);
  } else if (m.type === "rev") {
    rev = m.rev;
    if (race) race.rev = rev;
  } else if (m.type === "go") {
    go = true;
    race?.launch();
  }
};
