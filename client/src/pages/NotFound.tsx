import { Link } from "wouter";
import { Map } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-full w-full flex items-center justify-center p-6">
      <div className="cyber-card w-full max-w-lg p-10 text-center">
        <img src="/logo-mark.svg" alt="" className="w-16 h-16 mx-auto mb-6" />
        <h1 className="font-display text-5xl font-bold text-primary text-glow-cyan tracking-wider mb-2">404</h1>
        <h2 className="font-display text-sm tracking-widest text-foreground mb-4">ROUTE NOT FOUND</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          This page is not on the chart. It may have moved, or the address may be wrong.
        </p>
        <Link
          href="/map"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm border border-primary/40 bg-primary/10 text-primary font-mono text-sm font-bold tracking-wider hover:bg-primary/20 transition-colors"
        >
          <Map className="w-4 h-4" />
          BACK TO MAP
        </Link>
      </div>
    </div>
  );
}
