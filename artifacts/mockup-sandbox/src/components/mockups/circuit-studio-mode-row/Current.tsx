import { useState } from 'react';
import { MessageCircle, Wrench } from 'lucide-react';
import './_group.css';

type Mode = 'chat' | 'build';

export function Current() {
  const [mode, setMode] = useState<Mode>('chat');

  return (
    <section className="mode-row-preview" aria-label="Current Chat and Build mode row">
      <div className="builder-chat__mode-row">
        <div className="builder-chat__mode-tabs" role="tablist" aria-label="Conversation mode">
          <button type="button" role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'is-active' : ''} onClick={() => setMode('chat')}>
            <MessageCircle aria-hidden="true" /> Chat
          </button>
          <button type="button" role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'is-active' : ''} onClick={() => setMode('build')}>
            <Wrench aria-hidden="true" /> Build
          </button>
        </div>
        <p>{mode === 'chat' ? 'Clarify the idea, no edits proposed' : 'Shape an editable draft for review'}</p>
      </div>
    </section>
  );
}

export default Current;
