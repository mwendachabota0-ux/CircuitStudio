import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  getGetAiUsageQueryKey, useAskCircuitTutor, useGenerateCircuit, useGetAiUsage,
  useReviewCircuit, useSetAiKeySelection,
} from '@workspace/api-client-react';
import type { AiUsage, CircuitSpec as ApiCircuitSpec, TutorImageMimeType, TutorResponse } from '@workspace/api-client-react';
import {
  ArrowDownRight, ArrowRight, Check, CheckCircle2, CircuitBoard,
  Clipboard, Code2, FileCode2, Image, LoaderCircle, RefreshCw,
  TriangleAlert, ScanSearch, MoveUpRight, Maximize, Maximize2, Minimize, ZoomIn, ZoomOut,
  Bot, BookOpenCheck, CircleHelp, Eye, Lightbulb, ListChecks, MessageCircle, Send, ShieldAlert, X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import exampleCircuit from './exampleCircuit.json';
import { Redirect, Route, Switch, useLocation, Link, Router as WouterRouter } from 'wouter';

type ValidationReport = { errors: string[]; warnings: string[] };
type CircuitSpec = ApiCircuitSpec;
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
          <span className="strip-item">Idea to schematic</span>
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

function TutorGate() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <AuthLoading />;
  if (!isSignedIn || !userId) return <Redirect to="/" />;
  return <Tutor key={userId} userId={userId} />;
}

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 8;

function SchematicViewer({ svg, onFullscreenError }: { svg: string; onFullscreenError: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const autoFitRef = useRef(true);
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fitToView = useCallback(() => {
    const viewport = viewportRef.current;
    const graphic = viewport?.querySelector('svg');
    if (!viewport || !graphic) return;

    const viewBox = graphic.viewBox.baseVal;
    const width = viewBox.width || graphic.width.baseVal.value || 900;
    const height = viewBox.height || graphic.height.baseVal.value || 640;
    if (!width || !height) return;

    setCanvasSize({ width, height });
    const padding = 56;
    const scale = Math.min(
      (viewport.clientWidth - padding) / width,
      (viewport.clientHeight - padding) / height,
    );
    if (Number.isFinite(scale) && scale > 0) {
      const nextZoom = Math.max(MIN_ZOOM, scale);
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    }
    const nextOffset = { x: 0, y: 0 };
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
    autoFitRef.current = true;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    autoFitRef.current = true;
    const frame = requestAnimationFrame(fitToView);
    const observer = new ResizeObserver(() => {
      if (autoFitRef.current) fitToView();
    });
    let fullscreenFitFrame: number | undefined;
    const handleFullscreenChange = () => {
      const stage = viewport.parentElement;
      const fullscreen = document.fullscreenElement === stage;
      setIsFullscreen(fullscreen);
      if (fullscreen) {
        autoFitRef.current = true;
        fullscreenFitFrame = requestAnimationFrame(fitToView);
      }
    };
    observer.observe(viewport);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      cancelAnimationFrame(frame);
      if (fullscreenFitFrame !== undefined) cancelAnimationFrame(fullscreenFitFrame);
      observer.disconnect();
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [fitToView, svg]);

  const toggleFullscreen = async () => {
    const stage = viewportRef.current?.parentElement;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else if (document.fullscreenElement || !stage.requestFullscreen) {
        onFullscreenError();
      } else {
        autoFitRef.current = true;
        await stage.requestFullscreen();
      }
    } catch {
      onFullscreenError();
    }
  };

  const changeZoom = (direction: 1 | -1) => {
    autoFitRef.current = false;
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * (direction > 0 ? 1.2 : 1 / 1.2)));
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  };

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;

      const currentZoom = zoomRef.current;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentZoom * Math.exp(-delta * 0.002)));
      if (nextZoom === currentZoom) return;

      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - rect.width / 2;
      const pointerY = event.clientY - rect.top - rect.height / 2;
      const currentOffset = offsetRef.current;
      const nextOffset = {
        x: pointerX - ((pointerX - currentOffset.x) / currentZoom) * nextZoom,
        y: pointerY - ((pointerY - currentOffset.y) / currentZoom) * nextZoom,
      };

      autoFitRef.current = false;
      zoomRef.current = nextZoom;
      offsetRef.current = nextOffset;
      setZoom(nextZoom);
      setOffset(nextOffset);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [svg]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !canvasSize.width) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offsetRef.current.x,
      originY: offsetRef.current.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsPanning(true);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) > 2) {
      drag.moved = true;
      autoFitRef.current = false;
    }
    const nextOffset = { x: drag.originX + deltaX, y: drag.originY + deltaY };
    offsetRef.current = nextOffset;
    setOffset(nextOffset);
  };

  const stopPanning = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsPanning(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const panAmount = 40;
    const panByKey: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -panAmount, y: 0 },
      ArrowRight: { x: panAmount, y: 0 },
      ArrowUp: { x: 0, y: -panAmount },
      ArrowDown: { x: 0, y: panAmount },
    };
    if (panByKey[event.key]) {
      autoFitRef.current = false;
      const currentOffset = offsetRef.current;
      const nextOffset = {
        x: currentOffset.x + panByKey[event.key].x,
        y: currentOffset.y + panByKey[event.key].y,
      };
      offsetRef.current = nextOffset;
      setOffset(nextOffset);
      event.preventDefault();
    } else if (event.key === '+' || event.key === '=') {
      changeZoom(1);
      event.preventDefault();
    } else if (event.key === '-') {
      changeZoom(-1);
      event.preventDefault();
    } else if (event.key === '0') {
      fitToView();
      event.preventDefault();
    }
  };

  return (
    <>
      <div
        className={`schematic-paper schematic-viewport${isPanning ? ' is-panning' : ''}`}
        data-testid="canvas-schematic"
        ref={viewportRef}
        role="region"
        aria-label="Schematic viewer. Scroll or pinch to zoom at the pointer. Drag or use arrow keys to pan; use plus and minus to zoom; press zero to fit."
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopPanning}
        onPointerCancel={stopPanning}
        onKeyDown={handleKeyDown}
      >
        <div
          className="schematic-content"
          style={{
            width: canvasSize.width ? `${canvasSize.width}px` : undefined,
            height: canvasSize.height ? `${canvasSize.height}px` : undefined,
            left: `calc(50% + ${offset.x}px)`,
            top: `calc(50% + ${offset.y}px)`,
            transform: `translate(-50%, -50%) scale(${zoom})`,
          }}
        >
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </div>
      </div>
      <div className="schematic-controls" role="group" aria-label="Schematic zoom controls" data-viewer-controls>
        <button
          className="icon-button zoom-control-button"
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          data-testid="button-zoom-out"
          disabled={zoom <= MIN_ZOOM * 1.01}
          onClick={() => changeZoom(-1)}
        >
          <ZoomOut />
        </button>
        <span className="zoom-value" aria-live="polite" data-testid="status-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button zoom-control-button"
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          data-testid="button-zoom-in"
          disabled={zoom >= MAX_ZOOM * 0.99}
          onClick={() => changeZoom(1)}
        >
          <ZoomIn />
        </button>
        <span className="zoom-divider" aria-hidden="true" />
        <button
          className="quiet-button fit-control-button"
          type="button"
          aria-label="Reset zoom and fit schematic to view"
          title="Reset zoom and fit to view"
          data-testid="button-fit-schematic"
          onClick={fitToView}
        >
          <Maximize2 /> Fit
        </button>
        <button
          className="icon-button zoom-control-button fullscreen-control-button"
          type="button"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'View schematic fullscreen'}
          aria-pressed={isFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'View schematic fullscreen'}
          data-testid="button-schematic-fullscreen"
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize /> : <Maximize />}
        </button>
      </div>
    </>
  );
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
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const generate = useGenerateCircuit();
  const review = useReviewCircuit();
  const queryClient = useQueryClient();
  const reviewDraftRef = useRef('');
  const hasEditedDraftRef = useRef(false);
  const [draftReview, setDraftReview] = useState<{ signature: string; text: string; state: 'idle' | 'loading' | 'error' }>({ signature: '', text: '', state: 'idle' });
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
  const reviewSignature = JSON.stringify(spec);
  reviewDraftRef.current = reviewSignature;
  useEffect(() => {
    if (!hasEditedDraftRef.current) {
      setDraftReview({ signature: reviewSignature, text: '', state: 'idle' });
      return;
    }
    if (!libraryReady || jsonError || report.errors.length) {
      setDraftReview({ signature: reviewSignature, text: '', state: 'idle' });
      return;
    }
    setDraftReview({ signature: reviewSignature, text: '', state: 'loading' });
    const timer = window.setTimeout(() => {
      review.mutate({ data: { spec: spec as ApiCircuitSpec } }, {
        onSuccess: (result) => {
          if (reviewDraftRef.current !== reviewSignature) return;
          setDraftReview({ signature: reviewSignature, text: result.review, state: 'idle' });
          queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
        },
        onError: () => {
          if (reviewDraftRef.current === reviewSignature) setDraftReview({ signature: reviewSignature, text: '', state: 'error' });
        },
      });
    }, 850);
    return () => window.clearTimeout(timer);
  }, [spec, reviewSignature, jsonError, libraryReady, report.errors.length]);
  const svg = useMemo(() => {
    if (!window.CircuitDraw || report.errors.length) return '';
    try { return window.CircuitDraw.render(spec); }
    catch { return ''; }
  }, [spec, report, libraryReady]);
  const elementCount = spec.elements?.length ?? 0;

  const acceptSpec = (next: CircuitSpec) => {
    hasEditedDraftRef.current = true;
    setSpec(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError('');
  };

  const onJsonChange = (value: string) => {
    setJsonText(value);
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.title !== 'string' || !Array.isArray(parsed.elements)) {
        setJsonError('Expected a CircuitSpec with a string title and an elements array.');
        return;
      }
      if ((parsed.width !== undefined && typeof parsed.width !== 'number') || (parsed.height !== undefined && typeof parsed.height !== 'number')) {
        setJsonError('Optional width and height values must be numbers.');
        return;
      }
      const invalidElementIndex = parsed.elements.findIndex((element: unknown) => !element || typeof element !== 'object' || Array.isArray(element) || typeof (element as { type?: unknown }).type !== 'string');
      if (invalidElementIndex >= 0) {
        setJsonError(`Element ${invalidElementIndex + 1} must be an object with a string type.`);
        return;
      }
      hasEditedDraftRef.current = true;
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    const image = new window.Image();
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
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        <div className="top-user"><span data-testid="text-account-name">{user?.firstName || 'Your workbench'}</span><Link href="/studio/tutor" className="tutor-nav-link" data-testid="link-open-tutor"><MessageCircle /> Tutor</Link><button data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })}>Sign out</button><span className="live-dot" aria-hidden="true" /></div>
      </header>
      <div className="workspace">
        <div className="page-heading">
          <div><p className="eyebrow">A clearer path from idea to circuit</p><h1>Build a circuit you can understand.</h1><p className="subheading">Describe it, inspect the connections, then take the drawing with you.</p></div>
          <div className="save-state" data-testid="status-save">{saveTime}</div>
        </div>

        <section className="workbench" aria-label="Circuit workbench">
          <div className="panel prompt-panel">
            <h2 className="section-title">Start with a description</h2>
            <p className="section-note">Tell the generator what the circuit should do and name any parts or supply details you already know.</p>
            <label className="field-label" htmlFor="circuit-prompt"><span>Your circuit idea</span><span>{prompt.length}/3000</span></label>
            <textarea id="circuit-prompt" className="prompt-input" data-testid="input-circuit-prompt" minLength={8} maxLength={3000} value={prompt} onChange={(event) => { setPrompt(event.target.value); generate.reset(); }} placeholder="For example: a 9V LED indicator with a current-limiting resistor and an on/off switch." />
            <div className="prompt-hint"><span>Plain language works</span><span>8–3000 characters</span></div>
            {generationError && <p className="prompt-error" role="alert" data-testid="status-generation-error">{generationError}</p>}
            <div className="button-below">
              <button className="primary-button" data-testid="button-generate" onClick={submitPrompt} disabled={generate.isPending || prompt.trim().length < 8 || prompt.trim().length > 3000}>
                {generate.isPending ? <><LoaderCircle className="spin-icon" /> Building schematic…</> : 'Generate schematic'}
              </button>
            </div>
            <p className="quota-note">Gemini-reported tokens count toward your lifetime Circuit Studio allowance. Open Tutor to review usage and key selection.</p>
          </div>

          <div className="panel canvas-panel">
            <div className="canvas-toolbar">
              <div className="canvas-name"><span className="section-icon"><CircuitBoard /></span><strong>{spec.title || 'Untitled circuit'}</strong><span>{elementCount} elements</span></div>
              <div className="toolbar-actions">
                <button className="quiet-button reset-compact" data-testid="button-reset-example" onClick={resetExample} title="Restore the starter circuit"><RefreshCw /> Reset example</button>
                <div className="download-menu">
                  <button className="quiet-button download-trigger" type="button" aria-expanded={downloadMenuOpen} aria-haspopup="menu" data-testid="button-download-menu" onClick={() => setDownloadMenuOpen((open) => !open)} disabled={!svg}><Image /> Download</button>
                  {downloadMenuOpen && <div className="download-popover" role="menu">
                    <button type="button" role="menuitem" data-testid="button-export-svg" onClick={() => { exportSvg(); setDownloadMenuOpen(false); }}><FileCode2 /> SVG vector</button>
                    <button type="button" role="menuitem" data-testid="button-export-png-top" onClick={() => { exportPng(); setDownloadMenuOpen(false); }}><Image /> PNG image</button>
                  </div>}
                </div>
              </div>
            </div>
            <div className="schematic-stage">
              {!libraryReady ? <div className="schematic-paper canvas-empty"><div className="loading-skeleton" /><p>Loading the drawing engine…</p></div>
                : report.errors.length ? <div className="schematic-paper canvas-empty"><div className="empty-icon"><TriangleAlert /></div><h3>This schematic needs a repair</h3><p>Resolve the drawing errors in the JSON editor below to see the rendered circuit.</p></div>
                  : svg ? <SchematicViewer svg={svg} onFullscreenError={() => setToast('Fullscreen mode is unavailable in this browser.')} />
                    : <div className="schematic-paper canvas-empty"><div className="empty-icon"><CircuitBoard /></div><h3>Ready to draw</h3><p>Your schematic will appear here once the drawing engine is available.</p></div>}
            </div>
            <div className="canvas-foot"><span className="zoom-label" data-testid="status-canvas">{report.errors.length ? 'Drawing paused' : 'Vector schematic'}</span><span>Canvas {spec.width || 'auto'} × {spec.height || 'auto'}</span></div>
          </div>
        </section>

        <section className="panel review-panel" aria-label="AI draft review">
          <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><BookOpenCheck /></span>A second set of eyes</h2><span className="count-badge">Draft review</span></div>
          <div className="review-content">
            {jsonError || report.errors.length ? <p className="review-prompt">Fix JSON and drawing-structure issues to request a review of this draft.</p>
              : draftReview.signature !== reviewSignature ? <p className="review-prompt">Pause after a valid edit and an educational review will appear here.</p>
                : draftReview.state === 'loading' ? <div className="review-loading" role="status"><span className="loading-skeleton" />Preparing an educational review…</div>
                  : draftReview.state === 'error' ? <div className="review-error" role="alert"><TriangleAlert /><span>{review.error instanceof Error ? review.error.message : 'Review unavailable right now.'} Your draft is unchanged.</span><button type="button" onClick={() => {
                    setDraftReview({ signature: reviewSignature, text: '', state: 'loading' });
                    review.mutate({ data: { spec: spec as ApiCircuitSpec } }, {
                      onSuccess: (result) => {
                        if (reviewDraftRef.current !== reviewSignature) return;
                        setDraftReview({ signature: reviewSignature, text: result.review, state: 'idle' });
                        queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
                      },
                      onError: () => {
                        if (reviewDraftRef.current === reviewSignature) setDraftReview({ signature: reviewSignature, text: '', state: 'error' });
                      },
                    });
                  }}>Retry review</button></div>
                  : draftReview.text ? <p data-testid="text-ai-review">{draftReview.text}</p>
                    : <p className="review-prompt">Pause after a valid edit and an educational review will appear here.</p>}
            <p className="safety-note"><strong>Learning note:</strong> reviews are not electrical correctness, simulation, or safety checks.</p>
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
            <button className="quiet-button" data-testid="button-export-png" onClick={exportPng} disabled={!svg}><Image /> PNG</button>
            <button className="quiet-button" data-testid="button-copy-sheet" onClick={copySheet} disabled={!libraryReady || report.errors.length > 0}><Clipboard /> {copied ? 'Copied' : 'Copy EasyEDA sheet'}</button>
          </div>
        </section>
      </div>
      {toast && <div className="status-toast" role="status" data-testid="status-toast">{toast}</div>}
    </main>
  );
}

function Tutor({ userId }: { userId: string }) {
  const [, setLocation] = useLocation();
  const [libraryReady, setLibraryReady] = useState(!!window.CircuitDraw);
  const questionForm = useForm<{ question: string }>({ defaultValues: { question: '' } });
  const question = questionForm.watch('question');
  const [image, setImage] = useState<{ mimeType: TutorImageMimeType; dataBase64: string; name: string } | null>(null);
  const [imageError, setImageError] = useState('');
  const [formError, setFormError] = useState('');
  const [proposeEdits, setProposeEdits] = useState(false);
  const [response, setResponse] = useState<TutorResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const askTutor = useAskCircuitTutor();
  const selectKey = useSetAiKeySelection();
  const queryClient = useQueryClient();
  const usageQuery = useGetAiUsage({ query: { queryKey: getGetAiUsageQueryKey() } });
  const usage = usageQuery.data as AiUsage | undefined;
  const currentSpec = useMemo(() => readDraft(userId), [userId]);
  const remainingRatio = usage ? Math.max(0, Math.min(1, usage.tokensRemaining / usage.lifetimeLimit)) : 0;
  const requestError = askTutor.error instanceof Error
    ? askTutor.error.message
    : askTutor.error ? 'The tutor could not complete this request. Please try again.' : '';

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

  const handleImage = (file?: File) => {
    setImageError('');
    setImage(null);
    if (!file) return;
    const allowed: TutorImageMimeType[] = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.type as TutorImageMimeType)) {
      setImageError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setImageError('Image must be 4 MiB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const encoded = result.split(',')[1] || '';
      const decodedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
      if (!encoded || decodedBytes > 4 * 1024 * 1024) {
        setImageError('This image exceeds the 4 MiB decoded limit.');
        return;
      }
      setImage({ mimeType: file.type as TutorImageMimeType, dataBase64: encoded, name: file.name });
    };
    reader.onerror = () => setImageError('This image could not be read. Try another file.');
    reader.readAsDataURL(file);
  };

  const submitQuestion = (submittedQuestion: string) => {
    const trimmed = submittedQuestion.trim();
    if (trimmed.length < 1 || trimmed.length > 3000 || !usage?.canUseAi) return;
    setFormError('');
    setApplied(false);
    const data = {
      ...(trimmed ? { question: trimmed } : {}),
      ...(image ? { image: { mimeType: image.mimeType, dataBase64: image.dataBase64 } } : {}),
      currentSpec: currentSpec as ApiCircuitSpec,
      proposeEdits,
    };
    askTutor.mutate({ data }, {
      onSuccess: (result) => {
        setResponse(result);
        queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
      },
      onError: () => setResponse(null),
    });
  };

  const changeKey = (keyNumber: number) => {
    selectKey.mutate({ data: { keyNumber } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() }),
    });
  };
  const applyProposal = () => {
    if (!response?.proposedEdit) return;
    try {
      localStorage.setItem(`circuit-studio-draft-v1:${userId}`, JSON.stringify(response.proposedEdit.spec));
      setApplied(true);
      setLocation('/studio');
    } catch {
      setFormError('Could not save this proposal on this device. Your current draft is unchanged.');
    }
  };

  return (
    <main className="studio-shell tutor-shell">
      <header className="topbar">
        <Link href="/studio" className="brand" data-testid="link-tutor-studio"><span className="brand-mark"><CircuitBoard aria-hidden="true" /></span><span>Circuit Studio</span></Link>
        <div className="top-meta"><span className="live-dot" /><span>LEARNING DESK</span></div>
        <Link href="/studio" className="tutor-back-link" data-testid="link-back-to-studio"><ArrowRight /> Back to workbench</Link>
      </header>
      <div className="workspace tutor-workspace">
        <div className="page-heading tutor-heading">
          <div><p className="eyebrow">Ask carefully. Keep what you learn.</p><h1>Understand the circuit in front of you.</h1><p className="subheading">Ask a question or attach a clear image. Your workbench draft stays untouched unless you choose to apply a proposal.</p></div>
        </div>

        <div className="tutor-layout">
          <section className="panel tutor-compose-panel">
            <div className="tutor-intro"><span className="tutor-emblem"><Bot /></span><div><p className="eyebrow">Circuit tutor</p><h2>What are you curious about?</h2></div></div>
            <Form {...questionForm}>
              <form ref={formRef} onSubmit={questionForm.handleSubmit(({ question: submittedQuestion }) => submitQuestion(submittedQuestion))}>
                <FormField
                  control={questionForm.control}
                  name="question"
                  rules={{
                    validate: (value) => value.trim().length > 0 || !!image || 'Enter a question or attach a circuit image.',
                    maxLength: { value: 3000, message: 'Keep the question under 3,000 characters.' },
                  }}
                  render={({ field }) => (
                    <FormItem className="tutor-question-field">
                      <div className="field-label">
                        <FormLabel><span>Your question</span></FormLabel>
                        <span>{question.length}/3000</span>
                      </div>
                      <FormControl>
                        <textarea {...field} className="prompt-input tutor-question" data-testid="input-tutor-question" maxLength={3000} placeholder="What role might this capacitor play? Which details can you actually see in this drawing?" />
                      </FormControl>
                      <FormDescription className="sr-only">Ask a question about the current circuit or an attached image.</FormDescription>
                      <FormMessage className="prompt-error" role="alert" />
                    </FormItem>
                  )}
                />
                <div className="tutor-upload">
                  <label className="quiet-button upload-button" htmlFor="tutor-image"><Image /> Add an image</label>
                  <input id="tutor-image" data-testid="input-tutor-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => handleImage(event.target.files?.[0])} />
                  <span>PNG, JPEG, or WebP · up to 4 MiB</span>
                </div>
                {image && <div className="attached-file" data-testid="text-attached-image"><Image /><span>{image.name}</span><button type="button" aria-label="Remove attached image" data-testid="button-remove-image" onClick={() => setImage(null)}><X /></button></div>}
                {imageError && <p className="prompt-error" role="alert" data-testid="status-image-error">{imageError}</p>}
                <label className="proposal-toggle">
                  <input type="checkbox" data-testid="toggle-propose-edits" checked={proposeEdits} onChange={(event) => setProposeEdits(event.target.checked)} />
                  <span className="toggle-mark" />
                  <span><strong>Allow a proposed edit</strong><small>The tutor will show the complete proposed CircuitSpec. Nothing is applied automatically.</small></span>
                </label>
                <div className="tutor-submit-row">
                  <span className="tutor-input-hint">Your current local draft is included as context.</span>
                  <button className="primary-button" data-testid="button-ask-tutor" type="submit" disabled={askTutor.isPending || (!question.trim() && !image) || question.trim().length > 3000 || !!imageError || usageQuery.isLoading || !usage?.canUseAi}>
                    {askTutor.isPending ? <><LoaderCircle className="spin-icon" /> Thinking…</> : <><Send /> Ask the tutor</>}
                  </button>
                </div>
              </form>
            </Form>
            {formError && <p className="prompt-error" role="alert">{formError}</p>}
            {!usageQuery.isLoading && usage && !usage.canUseAi && <div className="quota-exhausted" role="status" data-testid="status-quota-exhausted"><ShieldAlert /><span><strong>Lifetime allowance reached</strong><small>AI requests are unavailable for this account right now. Your draft remains available in the workbench.</small></span></div>}
            {usageQuery.isError && <div className="usage-error" role="alert" data-testid="status-usage-error"><TriangleAlert /><span>Account allowance could not be loaded. Retry to check AI availability.</span><button type="button" onClick={() => usageQuery.refetch()}>Retry</button></div>}
            {requestError && <div className="tutor-error" role="alert" data-testid="status-tutor-error"><TriangleAlert /><span>{requestError}</span><button type="button" onClick={() => formRef.current?.requestSubmit()}>Retry</button></div>}
          </section>

          <aside className="panel usage-panel">
            <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><ListChecks /></span>Account allowance</h2></div>
            {usageQuery.isLoading ? <div className="usage-skeleton" role="status"><span /><span /><span /></div>
              : usage ? <div className="usage-content" data-testid="status-ai-usage">
                <div className="usage-key-row"><span>Active key</span><strong data-testid="text-active-key">#{usage.activeKeyNumber}</strong></div>
                <label className="usage-select-label" htmlFor="ai-key-select">Choose a configured key</label>
                <select id="ai-key-select" data-testid="select-ai-key" value={usage.activeKeyNumber} disabled={selectKey.isPending || usage.configuredKeyNumbers.length < 2} onChange={(event) => changeKey(Number(event.target.value))}>
                  {usage.configuredKeyNumbers.map((keyNumber) => <option value={keyNumber} key={keyNumber}>Key {keyNumber}</option>)}
                </select>
                {selectKey.isPending && <p className="usage-feedback" role="status">Switching account key…</p>}
                {selectKey.isError && <p className="prompt-error" role="alert">Key selection failed. Try again.</p>}
                <div className="allowance-meter"><div className="allowance-label"><span>Lifetime allowance remaining</span><strong>{usage.tokensRemaining.toLocaleString()} / {usage.lifetimeLimit.toLocaleString()}</strong></div><div className="meter-track"><span style={{ transform: `scaleX(${remainingRatio})` }} /></div></div>
                <p className="usage-detail">{usage.tokensUsed.toLocaleString()} used · {usage.tokensReserved.toLocaleString()} reserved</p>
                <p className="usage-footnote">Keys are selected by account configuration. Circuit Studio never asks for or stores API keys in your browser.</p>
              </div>
                : <div className="usage-fallback" role="status"><CircleHelp /><p>Allowance details are unavailable. You can still return to your saved workbench.</p><button type="button" className="quiet-button" onClick={() => usageQuery.refetch()}>Retry account check</button></div>}
          </aside>
        </div>

        <section className="tutor-response-area" aria-live="polite">
          {askTutor.isPending ? <div className="panel response-empty response-loading"><span className="loading-skeleton" /><p>The tutor is separating what is visible from what is inferred.</p></div>
            : response ? <TutorAnswer response={response} onApply={applyProposal} applied={applied} libraryReady={libraryReady} />
              : <div className="panel response-empty"><span className="response-empty-icon"><MessageCircle /></span><h2>Your explanation will appear here.</h2><p>Observed details, interpretation, uncertainty, and missing values stay in separate lanes.</p></div>}
        </section>
        <p className="tutor-safety"><ShieldAlert /> Educational explanations only. They are not electrical correctness, safety, simulation, or compliance checks. Do not rely on them to build, power, or use a circuit.</p>
      </div>
    </main>
  );
}

function TutorAnswer({ response, onApply, applied, libraryReady }: { response: TutorResponse; onApply: () => void; applied: boolean; libraryReady: boolean }) {
  const proposalPreview = useMemo(() => {
    const proposedSpec = response.proposedEdit?.spec;
    if (!proposedSpec || !libraryReady || !window.CircuitDraw) return { state: 'loading' as const, svg: '', errors: [], warnings: [] };
    try {
      const validation = window.CircuitDraw.validate(proposedSpec);
      if (validation.errors.length) return { state: 'invalid' as const, svg: '', errors: validation.errors, warnings: validation.warnings };
      return { state: 'ready' as const, svg: window.CircuitDraw.render(proposedSpec), errors: [], warnings: validation.warnings };
    } catch {
      return { state: 'invalid' as const, svg: '', errors: ['The proposed schematic could not be rendered.'], warnings: [] };
    }
  }, [response.proposedEdit?.spec, libraryReady]);
  const categories = [
    { title: 'Observed', icon: Eye, items: response.observed, className: 'observed' },
    { title: 'Inferred', icon: Lightbulb, items: response.inferred, className: 'inferred' },
    { title: 'Unknown', icon: CircleHelp, items: response.unknowns, className: 'unknown' },
    { title: 'Missing values', icon: ListChecks, items: response.missingValues, className: 'missing' },
  ];
  return (
    <article className="panel tutor-answer" data-testid="panel-tutor-answer">
      <div className="answer-heading"><span className="answer-mark"><BookOpenCheck /></span><div><p className="eyebrow">A careful explanation</p><h2>Here’s what we can say</h2></div></div>
      <p className="answer-prose" data-testid="text-tutor-answer">{response.answer}</p>
      <div className="answer-categories">
        {categories.map(({ title, icon: Icon, items, className }) => <section className={`answer-category ${className}`} key={title}>
          <h3><Icon />{title}<span>{items.length}</span></h3>
          {items.length ? <ul>{items.map((item, index) => <li key={`${title}-${index}`} data-testid={`text-${className}-${index}`}>{item}</li>)}</ul> : <p className="category-empty">Nothing listed in this category.</p>}
        </section>)}
      </div>
      {response.proposedEdit && <section className="proposal-card">
        <div className="proposal-heading"><div><p className="eyebrow">Optional change · not applied</p><h3>{response.proposedEdit.summary}</h3></div><span className="proposal-label">Review first</span></div>
        <div className="proposal-preview" data-testid="preview-proposed-schematic">
          <p className="proposal-preview-label">Schematic preview</p>
          {proposalPreview.state === 'loading' ? <p role="status">Loading the drawing preview…</p>
            : proposalPreview.state === 'invalid' ? <div className="proposal-preview-errors" role="alert"><strong>This proposal needs repair before it can be applied.</strong><ul>{proposalPreview.errors.map((error, index) => <li key={`proposal-error-${index}`}>{error}</li>)}</ul></div>
              : <div className="proposal-preview-svg" dangerouslySetInnerHTML={{ __html: proposalPreview.svg }} />}
          {proposalPreview.state === 'ready' && proposalPreview.warnings.length > 0 && <ul className="proposal-preview-warnings">{proposalPreview.warnings.map((warning, index) => <li key={`proposal-warning-${index}`}>{warning}</li>)}</ul>}
        </div>
        <details className="spec-details" open>
          <summary>Inspect exact proposed CircuitSpec</summary>
          <pre data-testid="text-proposed-circuit-spec">{JSON.stringify(response.proposedEdit.spec, null, 2)}</pre>
        </details>
        <div className="proposal-actions"><p>This replaces the current editable draft only after you choose Apply.</p><button type="button" className="primary-button" data-testid="button-apply-proposal" onClick={onApply} disabled={proposalPreview.state !== 'ready'}><Check /> Apply proposal</button></div>
        {applied && <p className="proposal-applied" role="status">Proposal saved to your workbench draft.</p>}
      </section>}
      <p className="answer-disclaimer">An explanation is not a verification. Confirm circuit behavior and safety with qualified sources and appropriate instruments.</p>
    </article>
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
          <Route path="/studio/tutor" component={TutorGate} />
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
