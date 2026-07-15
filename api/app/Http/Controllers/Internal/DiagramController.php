<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Http\Middleware\VerifyDiagramSecret;
use App\Http\Requests\Internal\RenderDiagramRequest;
use App\Services\Diagrams\DiagramEngines;
use App\Services\Diagrams\DiagramRenderer;
use App\Services\Diagrams\Exceptions\DiagramRenderException;
use Illuminate\Http\JsonResponse;

/**
 * Internal diagram-render endpoint (SPEC §6.2) — the API mediates Kroki so
 * readers never do. The web's diagram component POSTs {engine, source} during
 * server render and gets back the cached SVG's public URL; the browser then
 * embeds a static <img> pointing at /storage.
 *
 * Guarded by {@see VerifyDiagramSecret} (shared secret), not
 * a Policy — it is a trusted web→api internal call, not a workspace resource.
 */
class DiagramController extends Controller
{
    public function __invoke(RenderDiagramRequest $request, DiagramRenderer $renderer): JsonResponse
    {
        $engine = (string) $request->string('engine');
        $source = (string) $request->input('source');

        // Defence in depth: the web only ever sends an allowlisted, alias-resolved
        // engine, but a leaked secret must not turn this into an open Kroki proxy
        // (hard rule #3). An unknown engine is never forwarded.
        if (! DiagramEngines::allows($engine)) {
            return response()->json(['error' => 'unsupported_engine'], 422);
        }

        try {
            $url = $renderer->render($engine, $source);
        } catch (DiagramRenderException) {
            // Never-crash contract: the web renders its show-source panel on 422.
            return response()->json(['error' => 'render_failed'], 422);
        }

        return response()->json(['url' => $url]);
    }
}
