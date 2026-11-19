import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useGenerateCircuit } from '@workspace/api-client-react';
import {
  ArrowDownRight, ArrowRight, AlertTriangle, Check, CheckCircle2, CircuitBoard,
  Clipboard, Code2, Download, FileCode2, FileImage, LoaderCircle, RefreshCw,
  Sparkles, TriangleAlert, WandSparkles, ScanSearch, MoveUpRight,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import exampleCircuit from './exampleCircuit.json';
import { Redirect, Route, Switch, useLocation, Link, Router as WouterRouter } from 'wouter';

type ValidationReport = { errors: string[]; warnings: string[] };
type CircuitSpec = {
  title: string;
  width?: number;
  height?: number;
  elements: Array<Record<string, unknown>>;
  [key: string]: unknown;
};
type CircuitDrawApi = {
  render: (spec: CircuitSpec) => string;
  validate: (spec: CircuitSpec) => ValidationReport;
  buildSheet: (spec: CircuitSpec) => string;
};
declare global {
  interface Window { CircuitDraw?: CircuitDrawApi; }
  interface ImportMetaEnv {
    readonly VITE_CLERK_PUBLISHABLE_KEY: string;
    readonly VITE_CLERK_PROXY_URL: string;
  }
}

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const initialSpec = exampleCircuit as CircuitSpec;
const starterPrompt = 'A simple FM microphone transmitter with a 9V supply, electret microphone, one NPN transistor oscillator, a small tuning coil, capacitors, and a short antenna.';

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#176b55',
    colorForeground: '#263b40',
    colorMutedForeground: '#75817a',
    colorDanger: '#a4453e',
    colorBackground: '#fbfaf6',
    colorInput: '#fffefa',
    colorInputForeground: '#263b40',
    colorNeutral: '#263b40',
    fontFamily: 'DM Sans',
    borderRadius: '0.65rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbfaf6] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-[0_18px_55px_rgba(41,51,46,.10)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#20343b] font-bold tracking-[-0.04em]',
    headerSubtitle: 'text-[#687871]',
    socialButtonsBlockButtonText: 'text-[#263b40] font-semibold',
    formFieldLabel: 'text-[#52635e] font-semibold',
    footerActionLink: 'text-[#176b55] font-semibold',
    footerActionText: 'text-[#697871]',
    dividerText: 'text-[#7c8982]',
    identityPreviewEditButton: 'text-[#176b55]',
    formFieldSuccessText: 'text-[#39745d]',
    alertText: 'text-[#8f3e38]',
    logoBox: 'rounded-lg overflow-hidden',
    logoImage: 'object-contain',
    socialButtonsBlockButton: 'border-[#dedbd1] bg-[#fffefa] hover:bg-[#f3f1e8]',
    formButtonPrimary: 'bg-[#176b55] hover:bg-[#105643] text-[#fffaf0]',
    formFieldInput: 'bg-[#fffefa] text-[#263b40] border-[#dedbd1]',
    footerAction: 'text-[#697871]',
    dividerLine: 'bg-[#dedbd1]',
    alert: 'bg-[#f8eee4] border-[#ead9ca]',
    otpCodeFieldInput: 'bg-[#fffefa] text-[#263b40] border-[#dedbd1]',
    formFieldRow: 'text-[#52635e]',
    main: 'text-[#263b40]',
  },
};

function readDraft(userId: string): CircuitSpec {
  try {
    const saved = localStorage.getItem(`circuit-studio-draft-v1:${userId}`);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.elements)) return parsed;
    }
  } catch { /* A damaged local draft should never prevent opening the workbench. */ }
  return initialSpec;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (isSignedIn) return <Redirect to="/studio" />;
  return <Landing />;
}

function Landing() {
  return (
    <main className="landing">
      <header className="landing-nav">
        <Link href="/" className="brand" data-testid="link-brand-home">
          <span className="brand-mark"><CircuitBoard aria-hidden="true" /></span><span>Circuit Studio</span>
        </Link>
        <nav className="nav-actions" aria-label="Account">
          <Link href="/sign-in" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="nav-signup" data-testid="link-sign-up">Create account</Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="hero-kicker">A workbench for curious minds</p>
          <h1>Make the idea<br />visible<span>.</span></h1>
          <p>Describe the circuit you have in mind. Get a clear schematic you can inspect, refine, and carry into your next tool.</p>
          <div className="hero-ctas">
            <Link href="/sign-up" className="hero-cta" data-testid="link-start-building">Start building <ArrowRight /></Link>
            <Link href="/sign-in" className="hero-secondary" data-testid="link-return-to-studio">I have an account <MoveUpRight /></Link>
          </div>
          <div className="hero-note"><strong>Built for learning by doing</strong><span>·</span><span>No circuit expertise required</span></div>
        </div>
        <div className="hero-visual" aria-label="A sample transistor circuit schematic">
          <span className="hero-index">FIG. 01 — SIGNAL PATH</span>
          <div className="bench-card">
            <div className="bench-caption"><span>DESIGN STUDY / 004</span><span className="bench-light">DRAWING CHECKED</span></div>
            <div className="hero-schematic">
              <svg viewBox="0 0 760 360" role="img" aria-label="Illustrated FM transmitter circuit">
                <g fill="none" stroke="#286b58" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M83 173H186M186 173V101H288M186 173V250H288M288 101H346M288 250H346M414 101H489V173H568M414 250H489V173M568 173H663" />
                  <path d="M186 101V60H489V101M489 60V34M478 34H500M482 25H496" />
                  <path d="M83 173V282H186V250M663 173V282H568V250" />
                  <path d="M346 82V120M358 82V120M346 231V269M358 231V269" />
                  <path d="M390 153L414 173L390 193V153ZM390 173H370M390 173L371 205M370 205L352 216M370 205L388 216M370 205V230" />
                  <path d="M568 173V100H610M610 100V76M601 76H619M604 67H616M610 100V131" />
                  <circle cx="83" cy="173" r="10" fill="#fffefa" /><circle cx="663" cy="173" r="10" fill="#fffefa" />
                  <path d="M102 159V187M111 164V182" stroke="#d47b50" />
                  <path d="M244 92L258 78L272 92L258 106L244 92Z" fill="#fffefa" />
                  <path d="M244 241L258 227L272 241L258 255L244 241Z" fill="#fffefa" />
                </g>
                <g fill="#405a50" fontFamily="DM Mono, monospace" fontSize="13">
                  <text x="58" y="149">MIC</text><text x="234" y="63">R1</text><text x="235" y="219">R2</text>
                  <text x="330" y="73">C1</text><text x="330" y="291">C2</text><text x="380" y="145">Q1</text>
                  <text x="585" y="55">L1</text><text x="634" y="154">ANT</text><text x="176" y="48">+9V</text>
                </g>
                <g fill="#d47b50">
                  <circle cx="186" cy="173" r="4" /><circle cx="489" cy="173" r="4" /><circle cx="568" cy="173" r="4" />
                </g>
              </svg>
            </div>
            <div className="bench-foot"><span>FM MIC TRANSMITTER</span><span>8 PARTS · 2 NET NOTES</span></div>
          </div>
          <div className="floating-tag"><strong>YOUR IDEA, MAPPED</strong>Readable by design. Editable by you.</div>
        </div>
      </section>

      <div className="landing-strip">
        <div className="strip-inner">
          <span className="strip-label">A focused set of tools</span>
          <span className="strip-item"><WandSparkles /> Idea to schematic</span>
          <span className="strip-item"><Code2 /> Editable circuit spec</span>
          <span className="strip-item"><ScanSearch /> Structure checks</span>
          <span className="strip-item"><ArrowDownRight /> Exports when ready</span>
        </div>
      </div>

      <section className="landing-section">
        <div className="section-intro">
          <div><p className="hero-kicker">A little structure goes a long way</p><h2>From a sentence<br />to a circuit you can read.</h2></div>
          <p>Circuit Studio makes the first pass less intimidating. Bring a rough idea, get an inspectable drawing, and keep the parts you want to change close at hand.</p>
        </div>
        <div className="steps-line">
          <article className="step"><span className="step-number">01 / DESCRIBE</span><h3>Say what it should do</h3><p>Write in plain language. Mention the supply, parts, or behavior you already know.</p></article>
          <article className="step"><span className="step-number">02 / INSPECT</span><h3>Follow the connections</h3><p>See the circuit as a clean vector drawing, with structure notes alongside it.</p></article>
          <article className="step"><span className="step-number">03 / REFINE</span><h3>Keep your hands on it</h3><p>Edit the CircuitSpec directly, then export a drawing or an EasyEDA-ready sheet.</p></article>
        </div>
      </section>

      <section className="close-cta">
        <div className="close-cta-inner">
          <div><h2>Start with a question.<br />Leave with something to explore.</h2><p>Your first workbench is ready when you are.</p></div>
          <Link href="/sign-up" className="hero-cta" data-testid="link-create-account-bottom">Create your account <ArrowRight /></Link>
        </div>
      </section>
      <footer className="footer"><span>CIRCUIT STUDIO</span><span>Clear drawings. Curious makers.</span></footer>
    </main>
  );
}

function StudioGate() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn || !userId) return <Redirect to="/" />;
  return <Studio key={userId} userId={userId} />;
}

function Studio({ userId }: { userId: string }) {
  const [spec, setSpec] = useState<CircuitSpec>(() => readDraft(userId));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(readDraft(userId), null, 2));
  const [prompt, setPrompt] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [libraryReady, setLibraryReady] = useState(!!window.CircuitDraw);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const [saveTime, setSaveTime] = useState('Saved on this account');
  const generate = useGenerateCircuit();
  const { user } = useUser();
  const { signOut } = useClerk();

  useEffect(() => {
    if (window.CircuitDraw) { setLibraryReady(true); return; }
    const existing = document.querySelector<HTMLScriptElement>('script[data-circuit-draw]');
    const script = existing || document.createElement('script');
    const done = () => setLibraryReady(!!window.CircuitDraw);
    script.addEventListener('load', done);
    script.addEventListener('error', done);
    if (!existing) {
      script.src = `${import.meta.env.BASE_URL}circuit-draw.js`;
      script.dataset.circuitDraw = 'true';
      document.body.appendChild(script);
    }
    return () => { script.removeEventListener('load', done); script.removeEventListener('error', done); };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(`circuit-studio-draft-v1:${userId}`, JSON.stringify(spec));
      setSaveTime('Saved on this account');
    } catch { setSaveTime('Local storage unavailable'); }
  }, [spec, userId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const report = useMemo<ValidationReport>(() => {
    if (!window.CircuitDraw || !spec) return { errors: [], warnings: [] };
    try { return window.CircuitDraw.validate(spec); }
    catch (error) { return { errors: [error instanceof Error ? error.message : 'Could not validate this drawing.'], warnings: [] }; }
  }, [spec, libraryReady]);
  const svg = useMemo(() => {
    if (!window.CircuitDraw || report.errors.length) return '';
    try { return window.CircuitDraw.render(spec); }
    catch { return ''; }
  }, [spec, report, libraryReady]);
  const elementCount = spec.elements?.length ?? 0;

  const acceptSpec = (next: CircuitSpec) => {
    setSpec(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError('');
  };

  const onJsonChange = (value: string) => {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.elements)) {
        setJsonError('Expected a circuit object with an elements array.');
        return;
      }
      setSpec(parsed as CircuitSpec);
      setJsonError('');
    } catch {
      setJsonError('JSON is incomplete or malformed. Fix the syntax to update the drawing.');
    }
  };

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (trimmed.length < 8 || trimmed.length > 3000) return;
    generate.mutate({ data: { prompt: trimmed } }, {
      onSuccess: (result) => {
        acceptSpec(result);
        setToast('Generated schematic is ready to inspect.');
      },
    });
  };

  const download = (filename: string, content: BlobPart, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  const fileBase = (spec.title || 'circuit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'circuit';
  const exportJson = () => download(`${fileBase}.json`, JSON.stringify(spec, null, 2), 'application/json');
  const exportSvg = () => {
    if (!svg) return;
    download(`${fileBase}.svg`, svg, 'image/svg+xml;charset=utf-8');
  };
  const exportPng = () => {
    if (!svg) return;
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || 900;
      canvas.height = image.naturalHeight || 640;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = '#fffefa';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${fileBase}.png`;
            anchor.click();
            URL.revokeObjectURL(url);
          }
          URL.revokeObjectURL(svgUrl);
        }, 'image/png');
      } else URL.revokeObjectURL(svgUrl);
    };
    image.onerror = () => { URL.revokeObjectURL(svgUrl); setToast('PNG export could not render this SVG.'); };
    image.src = svgUrl;
  };
  const copySheet = async () => {
    if (!window.CircuitDraw || report.errors.length) return;
    try {
      await navigator.clipboard.writeText(window.CircuitDraw.buildSheet(spec));
      setCopied(true);
      setToast('EasyEDA build sheet copied.');
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setToast('Clipboard access was blocked by this browser.'); }
  };
  const resetExample = () => {
    acceptSpec(initialSpec);
    setPrompt('');
    generate.reset();
    setToast('FM transmitter example restored.');
  };
  const generationError = generate.error instanceof Error
    ? generate.error.message
    : generate.error ? 'Circuit generation failed. Please try again.' : '';

  return (
    <main className="studio-shell">
      <header className="topbar">
        <Link href="/studio" className="brand" data-testid="link-studio-home"><span className="brand-mark"><CircuitBoard aria-hidden="true" /></span><span>Circuit Studio</span></Link>
        <div className="top-meta"><span className="live-dot" /><span>SCHEMATIC WORKBENCH</span></div>
        <div className="top-user"><span data-testid="text-account-name">{user?.firstName || 'Your workbench'}</span><button data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })}>Sign out</button></div>
      </header>
      <div className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">A clearer path from idea to circuit</p><h1>Build a circuit you can understand.</h1><p className="subheading">Describe it, inspect the connections, then take the drawing with you.</p></div>
          <div className="save-state" data-testid="status-save">{saveTime}</div>
        </div>

        <section className="workbench" aria-label="Circuit workbench">
          <div className="panel prompt-panel">
            <h2 className="section-title"><span className="section-icon"><WandSparkles /></span>Start with a description</h2>
            <p className="section-note">Tell the generator what the circuit should do and name any parts or supply details you already know.</p>
            <label className="field-label" htmlFor="circuit-prompt"><span>Your circuit idea</span><span>{prompt.length}/3000</span></label>
            <textarea id="circuit-prompt" className="prompt-input" data-testid="input-circuit-prompt" minLength={8} maxLength={3000} value={prompt} onChange={(event) => { setPrompt(event.target.value); generate.reset(); }} placeholder="For example: a 9V LED indicator with a current-limiting resistor and an on/off switch." />
            <div className="prompt-hint"><span>Plain language works</span><span>8–3000 characters</span></div>
            {generationError && <p className="prompt-error" role="alert" data-testid="status-generation-error">{generationError}</p>}
            <div className="button-below">
              <button className="primary-button" data-testid="button-generate" onClick={submitPrompt} disabled={generate.isPending || prompt.trim().length < 8 || prompt.trim().length > 3000}>
                {generate.isPending ? <><LoaderCircle className="spin-icon" /> Building schematic…</> : <><Sparkles /> Generate schematic</>}
              </button>
            </div>
            <p className="quota-note">Each generation uses the quota and billing for the Gemini API key configured for this app.</p>
            <div className="example-divider">OR BEGIN WITH THE EXAMPLE</div>
            <div className="example-chip"><AlertTriangle aria-hidden="true" /><span>Loaded: <strong>Simple FM microphone transmitter</strong>. A useful starting point for exploring a multi-part design.</span></div>
          </div>

          <div className="panel canvas-panel">
            <div className="canvas-toolbar">
              <div className="canvas-name"><span className="section-icon"><CircuitBoard /></span><strong>{spec.title || 'Untitled circuit'}</strong><span>{elementCount} elements</span></div>
              <div className="toolbar-actions">
                <button className="quiet-button" data-testid="button-reset-example" onClick={resetExample} title="Restore the starter circuit"><RefreshCw /> Reset example</button>
                <button className="icon-button" data-testid="button-export-svg" onClick={exportSvg} disabled={!svg} title="Download SVG"><Download /></button>
              </div>
            </div>
            <div className="schematic-stage">
              <div className="schematic-paper" data-testid="canvas-schematic">
                {!libraryReady ? <div className="canvas-empty"><div className="loading-skeleton" /><p>Loading the drawing engine…</p></div>
                  : report.errors.length ? <div className="canvas-empty"><div className="empty-icon"><TriangleAlert /></div><h3>This schematic needs a repair</h3><p>Resolve the drawing errors in the JSON editor below to see the rendered circuit.</p></div>
                    : svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="canvas-empty"><div className="empty-icon"><CircuitBoard /></div><h3>Ready to draw</h3><p>Your schematic will appear here once the drawing engine is available.</p></div>}
              </div>
            </div>
            <div className="canvas-foot"><span className="zoom-label" data-testid="status-canvas">{report.errors.length ? 'Drawing paused' : 'Vector schematic'}</span><span>Canvas {spec.width || 'auto'} × {spec.height || 'auto'}</span></div>
          </div>
        </section>

        <section className="details-grid" aria-label="Circuit details">
          <div className="panel details-panel">
            <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><CheckCircle2 /></span>Structure check</h2><span className="count-badge" data-testid="status-validation-count">{report.errors.length ? `${report.errors.length} errors` : report.warnings.length ? `${report.warnings.length} notes` : 'Ready'}</span></div>
            <div className="validation-content">
              {!libraryReady ? <div className="validation-banner neutral" data-testid="status-validation"><LoaderCircle /><span>Checking the drawing…</span></div>
                : report.errors.length ? <div className="validation-banner warn" data-testid="status-validation"><TriangleAlert /><span>Drawing structure has {report.errors.length} error{report.errors.length === 1 ? '' : 's'}. Fix the JSON before exporting a schematic build sheet.</span></div>
                  : report.warnings.length ? <div className="validation-banner warn" data-testid="status-validation"><TriangleAlert /><span>Drawing structure is readable, with {report.warnings.length} connection or layout note{report.warnings.length === 1 ? '' : 's'} to review.</span></div>
                    : <div className="validation-banner good" data-testid="status-validation"><Check /><span>No drawing-structure errors or warnings. That is not an electrical safety or correctness check.</span></div>}
              {(report.errors.length > 0 || report.warnings.length > 0) && <ul className="validation-list">{report.errors.map((item, index) => <li className="error" key={`e-${index}`} data-testid={`validation-error-${index}`}>{item}</li>)}{report.warnings.map((item, index) => <li key={`w-${index}`} data-testid={`validation-warning-${index}`}>{item}</li>)}</ul>}
            </div>
            <p className="safety-note"><strong>Important:</strong> validation checks drawing and connectivity structure only—not electrical correctness, simulation, legal RF compliance, or build safety. Generated designs require expert review before use.</p>
          </div>

          <div className="panel details-panel">
            <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><Code2 /></span>Editable CircuitSpec</h2><span className="count-badge">JSON</span></div>
            <textarea className="json-editor" data-testid="input-circuit-json" aria-label="Editable CircuitSpec JSON" spellCheck={false} value={jsonText} onChange={(event) => onJsonChange(event.target.value)} />
            <div className="editor-footer"><span className="editor-status" data-testid="status-json">{jsonError || `${elementCount} elements · draft saved to your account on this device`}</span><button className="quiet-button" data-testid="button-export-json" onClick={exportJson}><FileCode2 /> Export JSON</button></div>
          </div>
        </section>

        <section className="export-bar" aria-label="Export circuit">
          <div className="export-copy"><strong>Take this circuit to your next tool.</strong><span>SVG and PNG are drawings. The EasyEDA sheet lists parts and joined nets.</span></div>
          <div className="export-actions">
            <button className="quiet-button" data-testid="button-export-svg-bottom" onClick={exportSvg} disabled={!svg}><FileCode2 /> SVG</button>
            <button className="quiet-button" data-testid="button-export-png" onClick={exportPng} disabled={!svg}><FileImage /> PNG</button>
            <button className="quiet-button" data-testid="button-copy-sheet" onClick={copySheet} disabled={!libraryReady || report.errors.length > 0}><Clipboard /> {copied ? 'Copied' : 'Copy EasyEDA sheet'}</button>
          </div>
        </section>
      </div>
      {toast && <div className="status-toast" role="status" data-testid="status-toast">{toast}</div>}
    </main>
  );
}

function SignInPage() {
  return <AuthLayout><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthLayout>;
}

function SignUpPage() {
  return <AuthLayout><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthLayout>;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <aside className="auth-aside">
        <Link href="/" className="brand" data-testid="link-auth-brand"><span className="brand-mark"><CircuitBoard /></span><span>Circuit Studio</span></Link>
        <div className="auth-aside-copy"><p className="eyebrow">Your workbench is waiting</p><h1>Build understanding, one connection at a time.</h1><p>Bring a circuit idea to the bench. Keep the schematic clear, editable, and yours.</p></div>
        <div className="auth-aside-foot">A CLEARER PATH FROM IDEA TO CIRCUIT</div>
      </aside>
      <div className="auth-main">
        <Link href="/" className="auth-back" data-testid="link-auth-home">Back to home</Link>
        <div className="auth-stage">{children}</div>
      </div>
    </main>
  );
}

function AuthLoading() {
  return <div className="auth-wait" role="status" data-testid="status-auth-loading">Getting your workbench ready…</div>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Welcome back', subtitle: 'Sign in and return to your workbench' } },
        signUp: { start: { title: 'Create your workbench', subtitle: 'Start turning circuit ideas into clear drawings' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkQueryClientCacheInvalidator />
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/studio" component={StudioGate} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </ClerkProvider>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <ClerkProviderWithRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
