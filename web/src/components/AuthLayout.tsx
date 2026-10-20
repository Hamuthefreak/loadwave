import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { APP_VERSION } from '../version';

/**
 * The frame every auth screen sits in.
 *
 * Sign-in, forgot-password and reset-password had drifted into two layouts:
 * sign-in was a split card with a marketing panel, the other two a narrower
 * "solo" card with their own border, padding, radius and label colours. Two
 * sets of CSS meant every future field had to be styled twice, and the two
 * had already diverged on input padding and label colour.
 *
 * There is now one shell. The `hero` panel is the only variable: pass it and
 * the shell is a split card on wide screens (the panel hides below 960px, as
 * before); leave it out and the shell is a single narrow column. The form
 * column, brand, wordmark and footer link are shared, so a new auth screen
 * writes its fields and nothing else.
 */
interface AuthLayoutProps {
  /** Marketing panel shown beside the form on wide screens. */
  hero?: ReactNode;
  /** Off for screens where the homepage is not somewhere the visitor can go. */
  backLink?: boolean;
  children: ReactNode;
}

export default function AuthLayout({ hero, backLink = true, children }: AuthLayoutProps) {
  return (
    <div className="ld-mkt ld-auth-wrap">
      <div className="ld-auth-shell" data-layout={hero ? 'split' : 'solo'}>
        {hero ? <aside className="ld-auth-hero">{hero}</aside> : null}

        <main className="ld-auth-card">
          <div className="ld-auth-brand">
            <span className="ld-wordmark">
              Loadwave<span className="ld-wordmark-dot">.</span>
            </span>
          </div>

          {children}

          {backLink ? (
            <p className="small ld-auth-back">
              <Link to="/">Back to homepage</Link>
            </p>
          ) : null}
          <span className="ld-version ld-auth-version">v{APP_VERSION}</span>
        </main>
      </div>
    </div>
  );
}
