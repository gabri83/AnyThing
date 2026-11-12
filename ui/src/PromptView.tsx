import { forwardRef } from 'react';
import type { PromptsMessage } from '@anything/shared';

export type ActivePrompt = PromptsMessage['prompts'][number];

interface PromptViewProps {
  prompt: ActivePrompt;
  /** How many more are waiting behind this one. */
  waiting: number;
  answer: (choice: string) => void;
}

/** Lines of a diff read better coloured; anything else is shown as written. */
function bodyLines(body: string) {
  return body.split('\n').map((line, index) => {
    const kind = line.startsWith('+ ') ? 'add' : line.startsWith('- ') ? 'del' : undefined;
    return (
      <div key={index} className="prompt-line" data-kind={kind}>
        {line || ' '}
      </div>
    );
  });
}

/**
 * A question that covers the whole screen until it is answered. The dial
 * scrolls the detail, pressing it gives the primary answer and the back
 * button the secondary one; every choice is also a touch target.
 */
export const PromptView = forwardRef<HTMLDivElement, PromptViewProps>(function PromptView(
  { prompt, waiting, answer },
  bodyRef
) {
  return (
    <div className="prompt">
      <div className="prompt-head">
        {(prompt.source || waiting > 0) && (
          <div className="prompt-source">
            {prompt.source}
            {waiting > 0 && ` (+${waiting} more)`}
          </div>
        )}
        <div className="prompt-title">{prompt.title}</div>
      </div>
      <div className="prompt-body" ref={bodyRef}>
        {prompt.body ? bodyLines(prompt.body) : null}
      </div>
      <div className="prompt-choices">
        {prompt.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className="prompt-choice"
            data-role={choice.role}
            onClick={() => answer(choice.id)}
          >
            {choice.label}
            {choice.role === 'primary' && <span className="prompt-key">press dial</span>}
            {choice.role === 'secondary' && <span className="prompt-key">back</span>}
          </button>
        ))}
      </div>
    </div>
  );
});
