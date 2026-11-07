import SearchBar from './SearchBar';
import WorkspaceSelector from './WorkspaceSelector';
import UserMenu from './UserMenu';

export default function Header() {

  return (
    <header className="header">
      {/* Left: Logo + Workspace */}
      <div className="header-left">
        <a href="/" className="header-logo-link">
          <img
            src="/HikoniQ_RGB_logo_monotoon_lagoon.svg"
            alt="HikoniQ"
            className="header-logo-icon"
          />
        </a>
        <div className="header-separator" />
        <WorkspaceSelector />
      </div>

      {/* Center: Search */}
      <div className="header-center">
        <SearchBar />
      </div>

      {/* Right: Actions + User */}
      <div className="header-right">
        <UserMenu />
      </div>
    </header>
  );
}
