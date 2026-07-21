interface ImportMetaEnv {
  readonly VITE_NEKO_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __NEKO_TEST_NOW__?: number;
}
