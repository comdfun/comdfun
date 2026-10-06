// First-visit intro: the office floor at night, counsel crossing it, "COMPANY.MD" building letter by letter, the
// title typing in, then the office doors close and swing open onto the site. Server-rendered and hidden unless the
// head script set `html.has-intro` (first visit this session, or ?intro=1), so crawlers, no-JS visitors and repeat visits
// never see it and nothing underneath shifts. All timing is CSS; INTRO_SCRIPT only flips classes on <html>.

const NAME = "COMPANY.MD";
const LINE = "A swarm of NFT-identified agents · AI tasks on chain";
const NAME_COLORS = ["pink", "cyan", "lime", "orange", "violet", "pink", "cyan", "md", "md", "md"];

export function Intro() {
  let k = 0;
  return (
    <div className="intro" role="dialog" aria-label="Company.md: attorneys at law" aria-modal="false">
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
            {LINE.split(/(\s+)/).map((w, wi) =>
              /^\s+$/.test(w) ? w : (
                <span key={wi} className="wd">
                  {[...w].map((ch, ci) => {
                    const n = k++;
                    return <span key={ci} className={`it-c${ch === "·" ? " sep" : ""}`} style={{ ["--n" as string]: n - 10 }}>{ch}</span>;
                  })}
                </span>
              ),
            )}
          </span>
        </p>
        <div className="it-enter"><span className="it-key">Enter</span><span className="it-enter-t">Press any key to enter the firm</span><span className="it-enter-m">Tap to enter</span></div>
      </div>
      <button type="button" className="intro-skip" data-intro-skip>Skip intro ›</button>
      <div className="intro-door l" aria-hidden="true"><div className="glass"><span>Company</span><small>Attorneys</small></div><i className="handle" /></div>
      <div className="intro-door r" aria-hidden="true"><div className="glass"><span className="md">.md</span><small>at law</small></div><i className="handle" /></div>
    </div>
  );
}

/**
 * Runs in <head> before first paint. Decides whether to show the intro (first visit per session; `?intro=1` forces;
 * automation and crawlers skip), then drives it: exit after the animation AND hydration (static card: 1.4 s), or at
 * once on click / key / Skip. Exit = doors close, then open onto the site. Only <html> classes change.
 */
export const INTRO_SCRIPT = `(function(){try{
var d=document.documentElement,q=/[?&]intro=1/.test(location.search),ss=window.sessionStorage;
var bot=navigator.webdriver||/bot|crawl|spider|slurp|lighthouse|preview/i.test(navigator.userAgent);
if(!q&&(bot||ss.getItem("company.intro")))return;
ss.setItem("company.intro","1");
d.classList.add("has-intro");var stat=!d.classList.contains("fx");if(stat)d.classList.add("intro-static");
var t0=performance.now(),done=false,MIN=stat?1400:6800;
function stop(e){if(!done&&e.cancelable)e.preventDefault()}
function fin(){d.classList.add("intro-gone");d.classList.remove("intro-closing","intro-opening");window.__introDone=true;try{window.dispatchEvent(new Event("company:intro-done"))}catch(e){}}
function exit(){if(done)return;done=true;clearInterval(iv);
 window.removeEventListener("wheel",stop,{passive:false});window.removeEventListener("touchmove",stop,{passive:false});
 if(stat||!d.classList.contains("fx")){d.classList.add("intro-fade");setTimeout(fin,420);return}
 d.classList.add("intro-closing");setTimeout(function(){d.classList.add("intro-opening")},560);setTimeout(fin,1500)}
window.__introExit=exit;
window.addEventListener("wheel",stop,{passive:false});window.addEventListener("touchmove",stop,{passive:false});
document.addEventListener("keydown",function(e){if(done)return;if(e.key!=="Tab"){e.preventDefault();exit()}},true);
document.addEventListener("click",function(e){if(done)return;var t=e.target;if(t&&t.closest&&t.closest(".intro")){e.preventDefault();exit()}},true);
var iv=setInterval(function(){var t=performance.now()-t0;if(t>=MIN&&(window.__companyReady||t>15000))exit()},100);
}catch(e){}})();`;
