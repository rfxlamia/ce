import { ConfigModal } from './components/ConfigModal';
import { OutcomeTabs } from './components/OutcomeTabs';
import { SampleReport } from './components/SampleReport';
import { SnippetBlock } from './components/SnippetBlock';
import { SECTIONS } from './content/sections';
import { ACTION_SNIPPET, CONFIG_SNIPPET } from './content/snippets';

export function App() {
  return (
    <>
      <h1>Continuous Evidence</h1>
      <nav aria-label="Sections">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <section id="problem" aria-labelledby="problem-title">
          <h2 id="problem-title">Problem</h2>
          <p>
            A Change can pass builds, tests and other Checks while its behavior when executed stays
            unproven. CE produces Evidence from runtime observation, and a reader can inspect that
            Evidence.
          </p>
          <p>
            CE does not repeat verification that existing Checks already provide adequately. CE does
            not promise that every Change is correct.
          </p>
        </section>
        <section id="how-ce-decides" aria-labelledby="how-ce-decides-title">
          <h2 id="how-ce-decides-title">How CE decides</h2>
          <p>
            Deterministic code decides the Outcome of a run. A model answer does not decide it
            directly.
          </p>
          <OutcomeTabs />
          <p>ERROR means the CE process failed to complete.</p>
        </section>
        <section id="sample-report" aria-labelledby="sample-report-title">
          <h2 id="sample-report-title">Sample report</h2>
          <SampleReport />
        </section>
        <section id="quick-start" aria-labelledby="quick-start-title">
          <h2 id="quick-start-title">Quick start</h2>
          <p>
            Add a ce.yml file to the root of your repository:
          </p>
          <SnippetBlock text={CONFIG_SNIPPET} label="Copy ce.yml" />
          <p>Then add a workflow that runs the CE Action:</p>
          <SnippetBlock text={ACTION_SNIPPET} label="Copy workflow" />
          <p>
            An OpenRouter API key is required in v0. Jev, CE&apos;s classifier, uses it. Store the
            key as the repository secret OPENROUTER_API_KEY.
          </p>
          <p>
            The Action posts an evidence comment on the pull request and uploads the Evidence as a
            workflow artifact.
          </p>
        </section>
      </main>
      <ConfigModal />
    </>
  );
}
