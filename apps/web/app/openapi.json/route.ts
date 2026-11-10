import { baseUrl } from "@/lib/http";
import { openapi } from "@/lib/openapi";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(JSON.stringify(openapi(baseUrl()), null, 2), {
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
