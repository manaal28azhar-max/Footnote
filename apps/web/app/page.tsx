import { AskDemo } from "@/components/AskDemo";

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <h1 className="display">Every AI answer pays the people it came from.</h1>
          <p className="lede">
            AI apps answer questions with other people’s writing, and almost never send a reader back. Footnote measures how much each creator’s work shaped an
            answer, pays them their share through PayPal, and gives everyone a receipt they can check.
          </p>
          <AskDemo />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2 className="h2">What happens when you press Ask</h2>
          <ol className="flow">
            <li>
              <h3>Find the sources</h3>
              <p>Footnote searches registered creators’ work and passes the best matches to the AI.</p>
            </li>
            <li>
              <h3>Write, then audit</h3>
              <p>One model writes the answer. A separate model marks which sources back each sentence, and must quote its evidence.</p>
            </li>
            <li>
              <h3>Split the credit fairly</h3>
              <p>Shapley values from game theory split each sentence between the sources behind it. Copies earn nothing; their share goes to the original.</p>
            </li>
            <li>
              <h3>Pay and prove it</h3>
              <p>The AI app’s PayPal-funded balance pays creators to the micro-cent. Earnings go out as PayPal payouts, each backed by a signed receipt.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div>
            <h2 className="h2">For creators</h2>
            <p className="muted">
              Prove you own your site, connect PayPal and set your terms, such as a higher price while your news is fresh. Then watch what your work earns, answer by
              answer.
            </p>
            <a className="btn ghost" href="/creators">
              See creators’ earnings
            </a>
          </div>
          <div>
            <h2 className="h2">For AI apps</h2>
            <p className="muted">
              One API call answers a question and settles what it owes. Top up with PayPal; when the balance runs out, the API replies with a 402 that an agent can act
              on. Every answer comes with an audit trail you can show a regulator or a court.
            </p>
            <a className="btn ghost" href="/docs">
              Read the API docs
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
