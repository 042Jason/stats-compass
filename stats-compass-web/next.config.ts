import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 상위 폴더(보수교육_프로젝트)에도 package-lock.json 이 있어서 Next 가 그쪽을
   * 워크스페이스 루트로 잘못 잡습니다. 루트를 못 박아 둡니다.
   */
  outputFileTracingRoot: path.resolve(process.cwd()),

  /**
   * lucide-react 는 package.json 에 exports 필드가 없습니다.
   * Next 15 는 기본으로 이 패키지에 배럴 임포트 최적화(optimizePackageImports)를
   * 적용해 `import { Compass } from "lucide-react"` 를 내부 경로로 재작성하는데,
   * 1.x 의 dist 구조에서는 그 경로가 React 의 createContext 를 모듈 최상단에서
   * 호출하는 파일로 잡혀 서버 컴포넌트에서 터집니다.
   *   TypeError: react.createContext is not a function
   * transpilePackages 로 지정하면 그 최적화를 건너뛰고 Next 가 직접 컴파일합니다.
   */
  transpilePackages: ["lucide-react"],

  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.supabase.co" }],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
