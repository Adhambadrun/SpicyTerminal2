"use strict";
/* test_booking_link.js — the Booking Link button must open a DIRECT airline
 * checkout link for qualified trips, and stay dim (with a spoken reason) for
 * everything else.
 *
 * What this pins down:
 *   - SpicyLinks.linkFor(engineSegs) is the single entry point: eligible
 *     trips come back with { carrier, kind, url, label }, the rest with a
 *     human reason the status line can show;
 *   - one marketing carrier per link: AA -> aa.com metasearch, DL ->
 *     delta.com trip summary, AS -> alaskaair.com, UA -> united.com,
 *     BA -> ba.com processOffer;
 *   - incomplete trips (???? clocks, unknown airports, missing dates),
 *     mixed-airline trips and non-bookable carriers are NOT eligible;
 *   - the app.js path is parse -> renderItinerary -> re-parse -> linkFor
 *     (refreshBookingLink re-reads the OUTPUT pane), so the suite runs that
 *     exact round-trip, not just hand-built segments;
 *   - DDMMM years roll to the upcoming occurrence (a past date means next
 *     year; today stays this year) and GDS noon/midnight clocks read right.
 */
const E = require("./spicy_engine.js");
const L = require("./spicy_links.js");

let PASS = 0, FAIL = 0;
function assert(cond, msg) {
  if (cond) { PASS++; console.log("PASS:", msg); }
  else { FAIL++; console.error("FAIL:", msg); }
}

/* The app lights the button from the OUTPUT pane, so convert exactly like it:
   parse the paste, render the GDS, re-parse the GDS, then link. */
function linkForPaste(text, nowMs) {
  const segs = E.parse(text)[0];
  if (!segs.length) return L.linkFor([], nowMs);
  const out = E.renderItinerary(segs);
  const again = E.parse(out)[0];
  return L.linkFor(again, nowMs);
}
function itenOf(url) {
  const m = /ITEN=(.*)$/.exec(url || "");
  return m ? decodeURIComponent(m[1]) : "";
}

/* ---------- 1. AA: metasearch embeds the exact flights ---------- */
{
  const q = linkForPaste("1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "AA" && q.kind === "aa-meta",
         "AA one-way is eligible (aa-meta)");
  assert(/^https:\/\/www\.aa\.com\/goto\/metasearch\?ITEN=/.test(q.url || ""),
         "AA link is an aa.com metasearch ITEN");
  const iten = itenOf(q.url);
  assert(iten.includes("oneWay") && iten.includes("A1S0C0I0Y0L0"),
         "AA ITEN is oneWay for 1 adult (no passenger UI to read)");
  assert(iten.includes("#AA|100|J|JFK|LHR|") && iten.includes("#JFK|LHR|0|0|"),
         "AA ITEN pins the exact flight, class and leg");
}
{
  const q = linkForPaste("1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\n" +
                         "2 AA 101 20NOV LHR JFK 900A 1200P J 777 8.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "AA", "AA round-trip is eligible");
  assert(itenOf(q.url).includes(",multi,"), "AA round-trip ITEN is multi");
}

/* ---------- 2. Delta: trip summary with priced segments ---------- */
{
  const q = linkForPaste("1 DL 1 10MAR JFK LHR 700P 700A¥1 D 764 7.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "DL" && q.kind === "delta",
         "DL one-way is eligible (delta)");
  assert(/^https:\/\/www\.delta\.com\/completepurchase\/trip-summary\?/.test(q.url || ""),
         "DL link is a delta.com trip summary");
  assert(/itinSegment%5B0%5D=/.test(q.url) && /numOfSegments=1/.test(q.url) &&
         /currencyCd=USD/.test(q.url) && /price=\d+\.\d\d/.test(q.url),
         "DL link carries the priced segment, pax and currency");
  const seg = decodeURIComponent((/itinSegment%5B0%5D=([^&]*)/.exec(q.url) || [])[1] || "");
  assert(/^0:D:JFK:LHR:DL:1:MAR:10:\d{4}:07P$/.test(seg),
         "DL segment pins class/route/flight/date/clock (" + seg + ")");
}

/* ---------- 3. Alaska ---------- */
{
  const q = linkForPaste("1 AS 100 15NOV SEA LAX 700A 1000A Y 738 2.53 954 N\nCABIN-ECONOMY");
  assert(q.eligible && q.carrier === "AS" && q.kind === "alaska",
         "AS one-way is eligible (alaska)");
  assert(/^https:\/\/www\.alaskaair\.com\/planbook\/shoppingstart\?/.test(q.url || ""),
         "AS link is an alaskaair.com shoppingstart");
  assert(/FT=ow/.test(q.url) && /F1=SEA%7CLAX%7C/.test(q.url) && /FARE=\d+\.\d\d/.test(q.url),
         "AS link carries trip type, flight and estimated fare");
}

/* ---------- 4. United (first leg + dates, like the source) ---------- */
{
  const q = linkForPaste("1 UA 100 15NOV EWR LHR 700P 700A¥1 C 777 7.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "UA" && q.kind === "united",
         "UA one-way is eligible (united)");
  assert(/^https:\/\/www\.united\.com\/en\/us\/fsr\/choose-flights\?/.test(q.url || ""),
         "UA link is a united.com choose-flights search");
  assert(/f=EWR&t=LHR&d=\d{4}-\d\d-\d\d/.test(q.url) && /tt=1/.test(q.url) && /sc=4/.test(q.url),
         "UA link carries route, date and business cabin code");
}
{
  const q = linkForPaste("1 UA 100 15NOV EWR LHR 700P 700A¥1 C 777 7.00 3459 N\n" +
                         "2 UA 101 20NOV LHR EWR 900A 1200P C 777 8.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && /tt=2/.test(q.url) && /&r=\d{4}-\d\d-\d\d/.test(q.url),
         "UA round-trip carries tt=2 and the return date");
}

/* ---------- 5. British Airways ---------- */
{
  const q = linkForPaste("1 BA 1543 31AUG ORD LHR 615P 805A¥1 R 788 7.50 3942 N\n" +
                         "2 BA 396 01SEP LHR CAI 1010A 520P J 32Q 5.10 2195 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "BA" && q.kind === "ba",
         "BA two-leg trip is eligible (ba)");
  assert(/^https:\/\/www\.britishairways\.com\/travel\/book\/public\/en_gb\/processOffer\?/.test(q.url || ""),
         "BA link is a ba.com processOffer");
  assert(/onds=ORD-CAI_\d{4}-\d\d-\d\d/.test(q.url) &&
         /cabin=C/.test(q.url) && /ond=1/.test(q.url),
         "BA link merges the connection into one ORD-CAI journey, business cabin");
}
{
  /* a real break (days later, new origin) stays two journeys */
  const q = linkForPaste("1 BA 1543 31AUG ORD LHR 615P 805A¥1 R 788 7.50 3942 N\n" +
                         "2 BA 396 05SEP CAI LHR 1010A 200P J 32Q 5.10 2195 N\nCABIN-BUSINESS");
  assert(q.eligible && /onds=ORD-LHR_\d{4}-\d\d-\d\d,CAI-LHR_\d{4}-\d\d-\d\d/.test(q.url) &&
         /ond=2/.test(q.url),
         "BA link keeps a broken trip as two journeys");
}

/* ---------- 6. not eligible: other carriers, mixed trips, gaps ---------- */
{
  const q = linkForPaste("1 TK 1 10MAR IST JFK 100P 400P J 777 11.00 5000 N\nCABIN-BUSINESS");
  assert(!q.eligible && /TK isn't bookable/.test(q.reason) && /AA, DL, AS, UA, BA/.test(q.reason),
         "TK is refused with the supported list (" + q.reason + ")");
}
{
  const q = linkForPaste("1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\n" +
                         "2 DL 1 16NOV LHR JFK 900A 1200P J 764 8.00 3459 N\nCABIN-BUSINESS");
  assert(!q.eligible && /Mixed bookable airlines \(AA \+ DL\)/.test(q.reason),
         "mixed AA+DL (both bookable) is refused as unbookable in one checkout");
}
/* AA + non-bookable carrier should book AA segments only */
{
  const q = linkForPaste("1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\n" +
                         "2 AT 965 16NOV LHR JFK 900A 1200P J 788 8.00 3459 N\nCABIN-BUSINESS");
  assert(q.eligible && q.carrier === "AA",
         "mixed AA+AT (AT not bookable) is eligible and books AA segments only");
  assert(/^https:\/\/www\.aa\.com\/goto\/metasearch\?/.test(q.url || ""),
         "mixed AA+AT creates AA checkout link");
  assert(itenOf(q.url).includes("#AA|100|J|JFK|LHR|"),
         "mixed AA+AT AA link includes only the AA flight");
}
{
  const q = linkForPaste("AA 100 15NOV JFK LHR"); /* no clocks -> ???? */
  assert(!q.eligible && /no usable time/.test(q.reason) && /AI FIX/.test(q.reason),
         "a ???? clock refuses with a repair hint (" + q.reason + ")");
}
{
  const q = L.linkFor([{ seg: 1, airline: "AA", flight_no: "100", date_ddmmm: "15NOV",
                         orig: "???", dest: "LHR", dep_time: "700P", arr_time: "700A",
                         arr_day_shift: 1, booking_class: "J" }]);
  assert(!q.eligible && /unknown airport/.test(q.reason),
         "an unknown airport refuses with a repair hint");
}
{
  const q = L.linkFor([]);
  assert(!q.eligible && /convert something first/.test(q.reason),
         "empty output refuses with 'convert something first'");
}

/* ---------- 7. dates roll to the upcoming occurrence ---------- */
{
  const now = new Date(2026, 9, 5, 12, 0, 0).getTime(); /* 2026-10-05 noon */
  assert(L.ymdFromDdmmm("04OCT", now) === "2027-10-04", "yesterday rolls to next year");
  assert(L.ymdFromDdmmm("05OCT", now) === "2026-10-05", "today stays this year (no same-day rollover bug)");
  assert(L.ymdFromDdmmm("06OCT", now) === "2026-10-06", "tomorrow stays this year");
  assert(L.ymdFromDdmmm("01JAN", now) === "2027-01-01", "last January means next January");
  assert(L.ymdFromDdmmm("bogus", now) === "", "garbage dates read as empty");
}

/* ---------- 8. GDS clocks ---------- */
{
  const c = (t) => JSON.stringify(L.parseGdsClock(t));
  assert(c("1005P") === '{"h":22,"m":5}', "1005P reads 22:05");
  assert(c("1200N") === '{"h":12,"m":0}', "1200N reads noon");
  assert(c("1200M") === '{"h":0,"m":0}', "1200M reads midnight");
  assert(c("1015A¥1") === '{"h":10,"m":15}', "a glued overnight tail is tolerated");
  assert(L.parseGdsClock("????") === null, "???? reads as no clock");
}

/* ---------- 9. deterministic links (same trip, same URL) ---------- */
{
  const text = "1 AS 100 15NOV SEA LAX 700A 1000A Y 738 2.53 954 N\nCABIN-ECONOMY";
  const a = linkForPaste(text).url, b = linkForPaste(text).url;
  assert(a === b, "AS link is byte-identical across runs");
  const t2 = "1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\nCABIN-BUSINESS";
  assert(linkForPaste(t2).url === linkForPaste(t2).url, "AA link is byte-identical across runs");
}

/* ---------- 10. the button is wired into the page ---------- */
{
  const fs = require("fs");
  const path = require("path");
  const TPL = fs.readFileSync(path.join(__dirname, "index_template.html"), "utf8");
  const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const BUILT = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const SB_START = TPL.indexOf('<div class="status">');
  const SB = TPL.slice(SB_START, TPL.indexOf("</div>", SB_START));
  const tag = (SB.match(/<button[^>]*id="btnBookingLink"[\s\S]*?<\/button>/) || [""])[0];
  assert(/>Booking Link<\/button>/.test(tag), "status row has a 'Booking Link' button");
  assert(/class="linkbtn"/.test(tag), "Booking Link is a .linkbtn like its neighbours");
  assert(SB.indexOf('id="btnAbout"') < SB.indexOf('id="btnBookingLink"') &&
         SB.indexOf('id="btnBookingLink"') < SB.indexOf('id="genKey"'),
         "order is About / Booking Link / Generate Api / ...");
  const CSS = TPL.slice(TPL.indexOf("<style>"), TPL.indexOf("</style>"));
  assert(/#btnBookingLink\.ready\{[^}]*#53d977/.test(CSS),
         ".ready lights the button terminal-green");
  assert(/if \(typeof refreshBookingLink === "function"\) refreshBookingLink\(\);/.test(APP),
         "setOut() re-checks eligibility on every repaint (guarded for sliced unit runs)");
  assert(/btnBookingLink"\)\) \$\("btnBookingLink"\)\.addEventListener\("click"/.test(APP),
         "clicking the button is handled in app.js");
  assert(APP.includes("window.open(url, \"_blank\"") && APP.includes("clipboard.writeText(url)"),
         "a click opens the checkout AND copies the link");
  assert(/id="btnBookingLink"/.test(BUILT) && BUILT.includes("function refreshBookingLink(") &&
         BUILT.includes("window.SpicyLinks = SpicyLinks"),
         "the built page carries the button, the wiring and the link engine");
}

/* ---------- 11. the real wiring, run against a stub DOM ---------- */
{
  const vm = require("vm");
  const fs = require("fs");
  const path = require("path");
  const APP = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");
  const SRC = APP.slice(APP.indexOf("/* BOOKING:BEGIN */"), APP.indexOf("/* BOOKING:END */"));
  assert(SRC.length > 500 && /function refreshBookingLink\(\)/.test(SRC),
         "BOOKING block extracted from app.js");

  function makeEl(id) {
    const set = new Set(), handlers = {};
    return {
      id, title: "",
      classList: { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) },
      addEventListener: (t, fn) => { handlers[t] = fn; },
      fire: (t) => handlers[t] && handlers[t](),
      _has: (c) => set.has(c)
    };
  }
  const els = {};
  const opened = [], copied = [];
  let statusMsg = "";
  const sandbox = {
    console,
    document: {
      getElementById: (id) => els[id] || (els[id] = makeEl(id)),
      createElement: () => ({ value: "", style: {}, select() {}, remove() {} }),
      body: { appendChild() {}, removeChild() {} }
    },
    navigator: { clipboard: { writeText: (t) => { copied.push(t); return { then: (ok) => ok() }; } } },
    window: {},
    setStatus: (msg) => { statusMsg = msg; }
  };
  sandbox.window = sandbox;
  sandbox.window.open = (url) => { opened.push(url); return {}; };
  sandbox.window.SpicyEngine = E;
  sandbox.window.SpicyLinks = L;
  vm.createContext(sandbox);
  vm.runInContext("var $ = function (id) { return document.getElementById(id); };", sandbox);
  vm.runInContext("var lastOut = '';", sandbox);
  vm.runInContext(SRC, sandbox, { filename: "booking.js" });
  const setOut = (text) => vm.runInContext("lastOut = " + JSON.stringify(text) + ";", sandbox);
  const refresh = () => vm.runInContext("refreshBookingLink();", sandbox);
  const btn = () => sandbox.document.getElementById("btnBookingLink");

  const AA_GDS = E.renderItinerary(E.parse("1 AA 100 15NOV JFK LHR 700P 700A¥1 J 777 7.00 3459 N\nCABIN-BUSINESS")[0]);
  const TK_GDS = E.renderItinerary(E.parse("1 TK 1 10MAR IST JFK 100P 400P J 777 11.00 5000 N\nCABIN-BUSINESS")[0]);

  setOut(""); refresh();
  assert(!btn()._has("ready"), "empty output leaves the button dim");
  btn().fire("click");
  assert(opened.length === 0 && /convert something first/.test(statusMsg),
         "clicking while dim explains instead of opening");

  setOut(AA_GDS); refresh();
  assert(btn()._has("ready") && /American Airlines/.test(btn().title),
         "an AA trip lights the button green with the airline in the tooltip");
  btn().fire("click");
  assert(opened.length === 1 && /^https:\/\/www\.aa\.com\/goto\/metasearch/.test(opened[0]),
         "click opens the AA checkout");
  assert(copied.length === 1 && copied[0] === opened[0] && /OPENED.*AA/.test(statusMsg),
         "the same link is copied and the status confirms it");

  setOut(TK_GDS); refresh();
  assert(!btn()._has("ready"), "a TK trip turns the light back off");
  btn().fire("click");
  assert(opened.length === 1 && /TK isn't bookable/.test(statusMsg),
         "clicking reports TK as unbookable without opening anything");
}

console.log("\n=== SUMMARY: " + PASS + " passed, " + FAIL + " failed ===");
process.exit(FAIL ? 1 : 0);
