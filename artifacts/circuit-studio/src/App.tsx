import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGenerateCircuit } from '@workspace/api-client-react';
import {
  AlertTriangle, Check, CheckCircle2, CircuitBoard, Clipboard, Code2,
  Download, FileCode2, FileImage, LoaderCircle, RefreshCw, Sparkles,
  TriangleAlert, WandSparkles,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import exampleCircuit from './exampleCircuit.json';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

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
}

const queryClient = new QueryClient();
const STORAGE_KEY = 'circuit-studio-draft-v1';
const initialSpec = exampleCircuit as CircuitSpec;
const starterPrompt = 'A simple FM microphone transmitter with a 9V supply, electret microphone, one NPN transistor oscillator, a small tuning coil, capacitors, and a short antenna.';

function readDraft(): CircuitSpec {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.elements)) return parsed;
    }
  } catch { /* A damaged local draft should never prevent opening the workbench. */ }
  return initialSpec;
}

function Home() {
  const [spec, setSpec] = useState<CircuitSpec>(readDraft);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(readDraft(), null, 2));
  const [prompt, setPrompt] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [libraryReady, setLibraryReady] = useState(!!window.CircuitDraw);
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const [saveTime, setSaveTime] = useState('Saved locally');
  const generate = useGenerateCircuit();

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(spec));
      setSaveTime('Saved locally');
    } catch { setSaveTime('Local storage unavailable'); }
  }, [spec]);

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
    const formatted = JSON.stringify(next, null, 2);
    setJsonText(formatted);
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
    if (trimmed.length < 8) return;
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
    setToast('FM transmitter example restored.');
  };
  const generationError = generate.error instanceof Error
    ? generate.error.message
    : generate.error ? 'Circuit generation failed. Please try again.' : '';

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><CircuitBoard aria-hidden="true" /></div><span>Circuit Studio</span></div>
        <div className="top-meta"><span className="live-dot" /><span>SCHEMATIC WORKBENCH</span></div>
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
            <textarea
              id="circuit-prompt"
              className="prompt-input"
              data-testid="input-circuit-prompt"
              maxLength={3000}
              value={prompt}
              onChange={(event) => { setPrompt(event.target.value); generate.reset(); }}
              placeholder="For example: a 9V LED indicator with a current-limiting resistor and an on/off switch."
            />
            <div className="prompt-hint"><span>Plain language works</span><span>8–3000 characters</span></div>
            {generationError && <p className="prompt-error" role="alert" data-testid="status-generation-error">{generationError}</p>}
            <div className="button-below">
              <button className="primary-button" data-testid="button-generate" onClick={submitPrompt} disabled={generate.isPending || prompt.trim().length < 8}>
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
            <div className="canvas-foot"><span className="zoom-label">{report.errors.length ? 'Drawing paused' : 'Vector schematic'}</span><span>Canvas {spec.width || 'auto'} × {spec.height || 'auto'}</span></div>
          </div>
        </section>

        <section className="details-grid" aria-label="Circuit details">
          <div className="panel details-panel">
            <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><CheckCircle2 /></span>Structure check</h2><span className="count-badge">{report.errors.length ? `${report.errors.length} errors` : report.warnings.length ? `${report.warnings.length} notes` : 'Ready'}</span></div>
            <div className="validation-content">
              {!libraryReady ? <div className="validation-banner warn"><LoaderCircle /><span>Waiting for the schematic checker to load.</span></div>
                : report.errors.length ? <div className="validation-banner warn"><TriangleAlert /><span>Drawing structure has {report.errors.length} error{report.errors.length === 1 ? '' : 's'}. Fix the JSON before exporting a schematic build sheet.</span></div>
                  : report.warnings.length ? <div className="validation-banner warn"><TriangleAlert /><span>Drawing structure is readable, with {report.warnings.length} connection or layout note{report.warnings.length === 1 ? '' : 's'} to review.</span></div>
                    : <div className="validation-banner good"><Check /><span>No drawing-structure errors or warnings. That is not an electrical safety or correctness check.</span></div>}
              {(report.errors.length > 0 || report.warnings.length > 0) && <ul className="validation-list">{report.errors.map((item, index) => <li className="error" key={`e-${index}`} data-testid={`validation-error-${index}`}>{item}</li>)}{report.warnings.map((item, index) => <li key={`w-${index}`} data-testid={`validation-warning-${index}`}>{item}</li>)}</ul>}
            </div>
            <p className="safety-note"><strong>Important:</strong> validation checks drawing and connectivity structure only—not electrical correctness, simulation, legal RF compliance, or build safety. Generated designs require expert review before use.</p>
          </div>

          <div className="panel details-panel">
            <div className="panel-heading"><h2 className="section-title"><span className="section-icon"><Code2 /></span>Editable CircuitSpec</h2><span className="count-badge">JSON</span></div>
            <textarea
              className="json-editor"
              data-testid="input-circuit-json"
              aria-label="Editable CircuitSpec JSON"
              spellCheck={false}
              value={jsonText}
              onChange={(event) => onJsonChange(event.target.value)}
            />
            <div className="editor-footer"><span className="editor-status" data-testid="status-json">{jsonError || `${elementCount} elements · draft saved on this device`}</span><button className="quiet-button" data-testid="button-export-json" onClick={exportJson}><FileCode2 /> Export JSON</button></div>
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
      {toast && <div className="status-toast" role="status">{toast}</div>}
      <style>{`.spin-icon { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}

function Router() {
  return <RoutedErrorBoundary><Switch><Route path="/" component={Home} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
