# ADR 008: QR Code Generation

## Status
Proposed

## Context
Users want QR codes for their shortened links. Rather than requiring external QR generators, gitly.sh should provide first-party QR generation with support for logo overlays.

## Decision
Implement a QR code endpoint at `/:slug/qr` that generates QR codes on-demand with optional logo embedding.

### Endpoint
```
GET /:slug/qr
GET /:slug/qr?logo=<url>&size=<px>&format=<png|svg>
```

### Query Parameters
| Parameter | Default | Range/Values | Description |
|-----------|---------|--------------|-------------|
| `size` | 256 | 64-1024 | Output size in pixels |
| `format` | png | png, svg | Output format |
| `logo` | none | URL | Logo image to embed in center |
| `logo_size` | 0.25 | 0.15-0.35 | Logo size as fraction of QR |

### Behavior
1. Lookup slug in KV to verify it exists
2. Generate QR code pointing to `https://gitly.sh/:slug`
3. If `logo` parameter provided:
   - Fetch logo from URL (with caching)
   - Resize logo to specified fraction of QR dimensions
   - Add white background padding around logo
   - Composite logo in center of QR
4. Return image with appropriate `Content-Type` header

### Technical Requirements
- **Error Correction:** Level H (30% recovery) when logo is present, Level M otherwise
- **QR Library:** `qrcode` package (Workers-compatible)
- **Image Processing:** `resvg-wasm` for SVG, canvas for PNG compositing
- **Caching:** 
  - Generated QR codes cached in R2 with 1-hour TTL
  - Fetched logos cached in R2 with 24-hour TTL
  - Cache key: `qr/{slug}/{hash(params)}`

### Response Headers
```
Content-Type: image/png (or image/svg+xml)
Cache-Control: public, max-age=3600
```

### Error Handling
| Condition | Response |
|-----------|----------|
| Slug not found | 404 Not Found |
| Invalid size (out of range) | 400 Bad Request |
| Logo fetch failed | Generate QR without logo, add `X-Logo-Error` header |
| Invalid logo format | 400 Bad Request |

## Consequences

### Positive
- Users get QR codes without external tools
- Logo support enables branded QR codes
- Edge-generated means low latency globally
- Caching reduces compute costs

### Negative
- Image processing adds complexity
- Logo fetching adds external dependency
- R2 storage costs (minimal with TTL)

### Future Considerations
- Default to GitHub avatar when no logo specified
- User config file for default logo
- Custom foreground/background colors
- SVG logo support (rasterize for PNG output)
