"use client";
/**
 * Top up an AI app's Footnote balance with the PayPal JavaScript SDK v6.
 * The server creates and captures the order; the browser never sets the
 * amount that gets credited.
 */
import { createElement, useEffect, useRef, useState } from "react";

const SDK = "https://www.sandbox.paypal.com/web-sdk/v6/core";
const AMOUNTS = ["5.00", "10.00", "25.00"];

type Session = { start(opts: { presentationMode: string }, order: Promise<{ orderId: string }>): Promise<void> };
type Instance = {
  findEligibleMethods(o: { currencyCode: string }): Promise<{ isEligible(m: string): boolean }>;
  createPayPalOneTimePaymentSession(o: { onApprove(d: { orderId: string }): void; onCancel(): void; onError(e: unknown): void }): Session;
};

function loadSdk(): Promise<void> {
  const w = window as unknown as { paypal?: unknown };
  if (w.paypal) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the PayPal SDK"));
    document.head.appendChild(s);
  });
}

export function TopUp({ hasVault }: { hasVault: boolean }) {
  const [amount, setAmount] = useState("10.00");
  const [vault, setVault] = useState(!hasVault);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "paying" | "done" | "error">("loading");
  const [message, setMessage] = useState("");
  const session = useRef<Session | null>(null);
  const opts = useRef({ amount, vault });
  opts.current = { amount, vault };

  useEffect(() => {
    (async () => {
      try {
        const tok = await fetch("/api/paypal/client-token");
        if (!tok.ok) {
          setState("unavailable");
          setMessage("PayPal isn’t connected on this deployment yet.");
          return;
        }
        const { accessToken } = await tok.json();
        await loadSdk();
        const paypal = (window as unknown as { paypal: { createInstance(o: unknown): Promise<Instance> } }).paypal;
        const sdk = await paypal.createInstance({ clientToken: accessToken, components: ["paypal-payments"], pageType: "checkout" });
        const eligible = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (!eligible.isEligible("paypal")) {
          setState("unavailable");
          setMessage("PayPal isn’t available in this browser.");
          return;
        }
        session.current = sdk.createPayPalOneTimePaymentSession({
          async onApprove({ orderId }) {
            setState("paying");
            const res = await fetch(`/api/v1/topups/${orderId}/capture`, { method: "POST" });
            const body = await res.json();
            if (res.ok) {
              setState("done");
              setMessage(`Paid. Balance is now $${(Number(body.balanceMicro) / 1e8).toFixed(2)}.`);
              setTimeout(() => location.reload(), 1500);
            } else {
              setState("error");
              setMessage(body.message || "PayPal approved the payment but it could not be captured.");
            }
          },
          onCancel() {
            setState("ready");
            setMessage("Payment cancelled. Nothing was charged.");
          },
          onError() {
            setState("error");
            setMessage("PayPal reported an error. Try again.");
          },
        });
        setState("ready");
      } catch (e) {
        setState("error");
        setMessage((e as Error).message);
      }
    })();
  }, []);

  async function pay() {
    if (!session.current) return;
    setMessage("");
    const order = fetch("/api/v1/topups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_usd: opts.current.amount, save_for_autoreload: opts.current.vault }),
    })
      .then((r) => r.json())
      .then((b) => {
        if (!b.orderId) throw new Error(b.message || "Could not start the payment.");
        return { orderId: b.orderId as string };
      });
    try {
      await session.current.start({ presentationMode: "auto" }, order);
    } catch (e) {
      setState("error");
      setMessage((e as Error).message);
    }
  }

  return (
    <div>
      <div className="tries" style={{ marginTop: 0 }}>
        Amount:
        {AMOUNTS.map((a) => (
          <button key={a} type="button" className={`chip ${a === amount ? "on" : ""}`} onClick={() => setAmount(a)}>
            ${a.replace(".00", "")}
          </button>
        ))}
      </div>
      <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: "14px 0" }}>
        <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} />
        Save this PayPal account so the app can reload itself when it runs low (up to the weekly limit)
      </label>
      {state === "ready" || state === "error" ? (
        <div onClick={pay} role="presentation" style={{ maxWidth: 320 }}>
          {createElement("paypal-button", { type: "pay", class: "paypal-gold" })}
        </div>
      ) : state === "loading" ? (
        <div className="skeleton" style={{ height: 44, maxWidth: 320 }} />
      ) : null}
      {message && <p className={`small ${state === "error" || state === "unavailable" ? "muted" : "ok"}`}>{message}</p>}
    </div>
  );
}
