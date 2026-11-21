/**
 * Back where there is somewhere to go back to, else a fixed screen: a screen opened on its own
 * (a reload of the web app, a link) has no history, and back() would do nothing.
 */
export interface BackRouter<H> {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: H) => void;
}

export function goBackOr<H>(router: BackRouter<H>, fallback: H): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
