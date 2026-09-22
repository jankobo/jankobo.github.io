/* global self, caches, fetch, URL, Response */

// CACHE_NAME 끝의 빌드 해시와 BUILD_ASSETS는 빌드 시 vite-plugin-sw-precache가 주입한다.
// 개발 중(주입 전)에는 앱 셸만 캐시한다.
const CACHE_NAME = "ippatsu-shell-mucpc5bc";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
const BUILD_ASSETS = ["/assets/assist-discard-CuA7_tc0.js","/assets/board3d-XsfIvinc.js","/assets/config-mcr3wgyf.js","/assets/glossary-DipQ2Uw0.js","/assets/main-C8tL19ym.css","/assets/main-hikbz6Va.js","/assets/mistake-scan.worker-CxqIwB0l.js","/assets/mpa-return-C3KhUZt6.js","/assets/number-field-CbKGqjkh.js","/assets/rules-DOuQlYTQ.js","/assets/simulator-BxRmVaG-.js","/assets/src-CuoTFyKG.js","/assets/tile-face-DfutoYTJ.js","/assets/tokens-BOALLjbJ.css","/assets/tokens-MtgcQ2TW.js"];

self.addEventListener("install", (event) => {
  // 해시된 JS/CSS 번들까지 프리캐시 → 온라인 방문 없이도 오프라인 콜드스타트가 동작한다.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...BUILD_ASSETS])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

// 요청 분류(순수 함수 — apps/web/tests/sw-classify.test.ts가 이 함수를 꺼내 실행한다).
//  shell : 앱 셸. 오직 루트 두 경로뿐이다.
//  doc   : 정적 문서(/rules.html, /ko/learn/ 등). 네트워크 우선 + 자기 키로 캐시.
//  asset : 해시된 번들·이미지 등. 캐시 우선.
// 종전 판정은 "/index.html로 끝나지 않는 .html"을 문서로 봤는데, 그러면 /ko/learn/(과
// /ko/learn/index.html)이 shell로 분류돼 cache.put("/index.html", 문서본문)으로 앱 셸을
// 오염시켰다 — 오프라인에서 게임 자리에 문서가 뜬다. 앱 셸을 화이트리스트로 못박아 막는다.
/** 타일 SVG 경로 접두 — 쿼리 무시 폴백을 이 아래로만 허용한다(아래 fetch 핸들러). */
const TILE_ASSET_PREFIX = "/assets/tiles/";

function classifyRequest(pathname, mode) {
  if (pathname === "/" || pathname === "/index.html") return "shell";
  if (pathname.endsWith(".html") || mode === "navigate") return "doc";
  return "asset";
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  // index.html(=앱 셸)은 매 배포마다 새 해시 번들을 참조하므로 '네트워크 우선'으로 받아야
  // 배포 직후에도 최신 앱이 뜬다(cache-first면 옛 index.html이 옛 번들을 물고 와 화면이 안 바뀜).
  // 해시된 에셋(/assets/*)은 내용 불변이라 '캐시 우선'으로 빠르게 + 오프라인 지원.
  // 정적 문서(예: /rules.html)는 앱 셸이 아니다 — 셸로 취급하면 아래 cache.put("/index.html", …)이
  // 문서 본문으로 앱 셸 캐시를 오염시켜, 오프라인 폴백이 게임 대신 그 문서를 띄운다.
  const kind = classifyRequest(url.pathname, request.mode);
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 정적 문서는 해시가 없어 배포로 내용이 바뀔 수 있다 → 네트워크 우선 + 자체 키로 캐시(오프라인 폴백).
      if (kind === "doc") {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) void cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(request, { ignoreVary: true })) ?? Response.error();
        }
      }
      if (kind === "shell") {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) void cache.put("/index.html", fresh.clone());
          return fresh;
        } catch {
          // 오프라인: 캐시된 앱 셸로 폴백.
          return (await cache.match("/index.html", { ignoreVary: true }))
            ?? (await cache.match(request, { ignoreVary: true }))
            ?? Response.error();
        }
      }
      // ignoreVary: 모듈 스크립트(CORS, Origin 헤더)가 프리캐시 엔트리(Vary)와 어긋나 미스나지 않게.
      // 쿼리 무시 폴백은 **타일 SVG(`?r=`)에만** 좁힌다 — 2026-07-29 리뷰가 잡은 구멍:
      // 전 asset에 걸면 **캐시버스팅을 무력화한다**. `/x.js?v=1`만 캐시된 상태에서 `?v=2`를 요청하면
      // 정확 매칭이 실패하는 **바로 그 순간**이 캐시버스팅이 일어나는 순간인데, 폴백이 낡은 바이트를
      // 돌려주고 `cache.put`도 안 일어나 영구 고착된다("정확 매칭이 우선이라 안전"은 두 변종이 모두
      // 캐시에 있을 때만 참이다).
      const tileGen = kind === "asset"
        && url.pathname.startsWith(`${TILE_ASSET_PREFIX}`)
        && [...url.searchParams.keys()].every((k) => k === "r");
      const cached = await cache.match(request, { ignoreVary: true })
        // 쿼리 무시 폴백(2026-07-29) — **정확 매칭이 실패했을 때만, 그리고 타일 SVG만**.
        //
        // ⚠⚠ **2026-09-03 현재 `?r=`를 «붙이는» 코드가 하나도 없다.** 그 쿼리를 달던 것은
        // pixi 로더(`board.ts` `loadSkinTextures`)였고 — 래스터 해상도를 세대 키로 삼아 pixi
        // `Assets`의 src dedup을 우회하는 유일한 방법이었다 — 그 파일이 지워졌다(요구 24 슬라이스 ②).
        // 3D 아틀라스는 SVG를 쿼리 없이 한 번 받아 자기가 굽는다. **그래서 이 폴백은 지금 아무도
        // 안 타는 방어물이다.** 남겨 둔 이유는 지우는 쪽이 오프라인 캐시 동작을 건드리기 때문이고,
        // 실제 정리는 「죽은 파생 걷기」(슬라이스 ③) 몫이다. 되살릴 사람은 **누가 쿼리를 붙이는지**부터
        // 답할 것.
        //
        // 종전 근거(옛 pixi 경로에서 참이던 것): 쿼리는 클라이언트 래스터 크기만 바꾸고 서버가
        // 주는 바이트는 같으므로 다른 `?r=` 변종을 줘도 정확했고, 이게 없으면 오프라인에서 해상도
        // 버킷이 바뀌는 순간 캐시 미스 → 패 그림이 placeholder로 떨어졌다. 정확 매칭이 항상
        // 우선이라 해시 번들처럼 쿼리가 의미를 갖는 자원의 동작은 바뀌지 않는다.
        ?? (tileGen ? await cache.match(request, { ignoreVary: true, ignoreSearch: true }) : undefined);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) void cache.put(request, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});
