<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\ApprovalResource;
use App\Models\Approval;
use App\Models\Document;
use App\Services\Approvals\ApprovalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ApprovalController extends Controller
{
    public function __construct(
        private readonly ApprovalService $approvals,
    ) {}

    public function store(Request $request, Document $document): JsonResponse
    {
        $this->authorize('approve', [Approval::class, $document]);

        [$approval, $status] = $this->approvals->approveCurrent($document, $request->user(), $request->ip());

        return ApprovalResource::make($approval)
            ->response()
            ->setStatusCode($status);
    }

    public function destroy(Request $request, Approval $approval): Response
    {
        $this->authorize('revoke', $approval);

        $this->approvals->revoke($approval, $request->user(), $request->ip());

        return response()->noContent();
    }
}
