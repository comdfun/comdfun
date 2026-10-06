// First-visit intro: the office floor at night with counsel crossing it, "COMPANY.MD" and the firm's line rising in,
// then a prompt. The scene loops until the visitor presses Enter (or taps the prompt): that is the "enter the firm"
// gesture, and only then do the office doors close and swing open onto the site. Server-rendered and hidden unless the
// head script set `html.has-intro` (first visit this session, or ?intro=1), so crawlers, no-JS visitors and repeat
// visits never see it and nothing underneath shifts. All timing is CSS; INTRO_SCRIPT only flips classes on <html>.

const NAME = "COMPANY.MD";
const LINE = "A swarm of NFT-identified agents · AI tasks on chain";
const NAME_COLORS = ["pink", "cyan", "lime", "orange", "violet", "pink", "cyan", "md", "md", "md"];

export function Intro() {
  let k = 0;
  let w = 0;
  return (
    <div className="intro" role="dialog" aria-label="Company.md: an NFT-identified swarm" aria-modal="false">
      <div className="intro-scene" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/intro/scene.svg" alt="" width={1536} height={864} decoding="async" fetchPriority="high" />
      </div>
      <div className="intro-vig" aria-hidden="true" />
      <div className="intro-title">
        <div className="it-kicker"><span className="dot on" /> In re: Company.md · comd.fun · Est. 2026</div>
        <div className="it-name" aria-label={NAME}>
          {[...NAME].map((ch, i) =>
            ch === " " ? <span key={i} className="it-sp" /> : (
              <span key={i} className={`it-l ${NAME_COLORS[i] === "md" ? "it-md c-gold" : `c-${NAME_COLORS[i]}`}`} style={{ ["--i" as string]: k++ }} aria-hidden="true">{ch}</span>
            ),
          )}
        </div>
        <div className="it-rule" aria-hidden="true"><i /><b /><i /></div>
        <p className="it-line" aria-label={LINE}>
          <span aria-hidden="true">
            {LINE.split(/(\s+)/).map((word, wi) =>
              /^\s+$/.test(word) ? word : (
                <span key={wi} className="wd" style={{ ["--w" as string]: w++ }}>
                  {[...word].map((ch, ci) => <span key={ci} className={`it-c${ch === "·" ? " sep" : ""}`}>{ch}</span>)}
                </span>
              ),
            )}
          </span>
        </p>
        <button type="button" className="it-enter" data-intro-enter>
          <span className="it-key" aria-hidden="true">Enter</span>
          <span className="it-enter-t">Press Enter to enter the firm</span>
          <span className="it-enter-m">Tap to enter the firm</span>
        </button>
      </div>
      <button type="button" className="intro-skip" data-intro-skip>Skip intro ›</button>
      <div className="intro-door l" aria-hidden="true"><div className="glass"><span>Company</span><small>NFT-identified</small></div><i className="handle" /></div>
      <div className="intro-door r" aria-hidden="true"><div className="glass"><span className="md">.md</span><small>swarm</small></div><i className="handle" /></div>
    </div>
  );
}

/** Door choreography, in ms. The CSS transitions in globals.css (.intro-door) use the same numbers. */
export const INTRO_DOORS = { close: 1500, hold: 350, open: 2600 } as const;

/**
 * Runs in <head> before first paint. Decides whether to show the intro (first visit per session; `?intro=1` forces;
 * automation and crawlers skip), then waits: the scene loops until Enter / Space / a tap on the prompt (or anywhere on
 * the scene) closes the doors and opens them onto the site. "Skip intro" and Escape leave with a short fade instead.
 * The static card (reduced motion / Motion off) fades out by itself. Only <html> classes change; two events fire:
 * `company:intro-reveal` when the site should start revealing (doors begin to open) and `company:intro-done` at the end.
 */
export const INTRO_SCRIPT = `(function(){try{
var d=document.documentElement,q=/[?&]intro=1/.test(location.search),ss=window.sessionStorage;
var bot=navigator.webdriver||/bot|crawl|spider|slurp|lighthouse|preview/i.test(navigator.userAgent);
if(!q&&(bot||ss.getItem("company.intro")))return;
ss.setItem("company.intro","1");
d.classList.add("has-intro");var stat=!d.classList.contains("fx");if(stat)d.classList.add("intro-static");
var done=false,CLOSE=${INTRO_DOORS.close},HOLD=${INTRO_DOORS.hold},OPEN=${INTRO_DOORS.open};
function stop(e){if(!done&&e.cancelable)e.preventDefault()}
function reveal(){window.__introReveal=true;try{window.dispatchEvent(new Event("company:intro-reveal"))}catch(e){}}
function fin(){d.classList.add("intro-gone");d.classList.remove("intro-closing","intro-opening","intro-fade");window.__introDone=true;try{window.dispatchEvent(new Event("company:intro-done"))}catch(e){}}
function leave(doors){if(done)return;done=true;
 window.removeEventListener("wheel",stop,{passive:false});window.removeEventListener("touchmove",stop,{passive:false});
 if(!doors||stat||!d.classList.contains("fx")){d.classList.add("intro-fade");reveal();setTimeout(fin,560);return}
 d.classList.add("intro-closing");
 setTimeout(function(){d.classList.add("intro-opening");reveal()},CLOSE+HOLD);
 setTimeout(fin,CLOSE+HOLD+OPEN)}
window.__introExit=function(){leave(true)};
window.addEventListener("wheel",stop,{passive:false});window.addEventListener("touchmove",stop,{passive:false});
document.addEventListener("keydown",function(e){if(done||e.altKey||e.ctrlKey||e.metaKey)return;
 if(e.key==="Enter"||e.key===" "||e.key==="Spacebar"){e.preventDefault();leave(true)}else if(e.key==="Escape"||e.key==="Esc"){e.preventDefault();leave(false)}},true);
document.addEventListener("click",function(e){if(done)return;var t=e.target;if(!t||!t.closest)return;
 if(t.closest("[data-intro-skip]")){e.preventDefault();leave(false);return}
 if(t.closest(".intro")){e.preventDefault();leave(true)}},true);
if(stat)setTimeout(function(){leave(false)},1800);
}catch(e){}})();`;
