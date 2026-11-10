"use client";
import dynamic from "next/dynamic";
import type { TimelineSource, TimelineEarning } from "./TermsTimeline";

// Bryntum touches the DOM, so it renders in the browser only.
const TermsTimeline = dynamic(() => import("./TermsTimeline"), { ssr: false, loading: () => <div className="skeleton" style={{ height: 220 }} /> });

export function TimelineClient(props: { creatorId: string; sources: TimelineSource[]; editable: boolean; earnings?: TimelineEarning[] }) {
  return <TermsTimeline {...props} />;
}
