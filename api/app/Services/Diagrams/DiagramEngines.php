<?php

namespace App\Services\Diagrams;

/**
 * The Kroki engine allowlist — the API-side gate that keeps the internal render
 * endpoint from becoming an open proxy to Kroki for arbitrary engines (SPEC
 * §6.2, hard rule #3: only the explicit allowlist is ever forwarded).
 *
 * ── One allowlist, two languages ─────────────────────────────────────────────
 * The CANONICAL definition lives in web/lib/remark-diagrams.ts (KROKI_ENGINES).
 * The web resolves fence-language aliases (dot→graphviz, puml→plantuml, …) to a
 * canonical engine there BEFORE it ever calls this endpoint, so only canonical
 * names arrive here — this list therefore mirrors KROKI_ENGINES exactly and
 * carries no aliases. Keep the two in lockstep: when one changes, change both in
 * the same commit (the hand-written TS/PHP duplication M1 accepts, TODOS).
 */
final class DiagramEngines
{
    /**
     * Canonical Kroki engine names. Mirror of KROKI_ENGINES in
     * web/lib/remark-diagrams.ts — same set, same order.
     *
     * @var list<string>
     */
    public const ALL = [
        'blockdiag',
        'bpmn',
        'bytefield',
        'c4plantuml',
        'd2',
        'dbml',
        'ditaa',
        'erd',
        'excalidraw',
        'graphviz',
        'mermaid',
        'nomnoml',
        'nwdiag',
        'pikchr',
        'plantuml',
        'seqdiag',
        'structurizr',
        'svgbob',
        'vega',
        'vegalite',
        'wavedrom',
    ];

    /** Whether an engine name may be forwarded to Kroki. */
    public static function allows(string $engine): bool
    {
        return in_array($engine, self::ALL, true);
    }
}
