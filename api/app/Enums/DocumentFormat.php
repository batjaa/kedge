<?php

namespace App\Enums;

/**
 * Normalized format a document is stored and rendered as (SPEC 16, 5.2).
 *
 * M1's raw-URL tracer only produces `md` (stored as-is). `mdx` and `html`
 * columns of behaviour arrive with their normalization paths (#20 hardened MDX,
 * #19 HTML→markdown); the enum carries them now so the column never migrates.
 */
enum DocumentFormat: string
{
    case Md = 'md';
    case Mdx = 'mdx';
    case Html = 'html';
}
