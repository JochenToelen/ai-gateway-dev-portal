import { useDeferredValue, useEffect, useState } from 'react';
import {
  AlertCircle,
  Cable,
  ChevronLeft,
  ChevronRight,
  Code2,
  Globe,
  Library,
  Radio,
  RefreshCw,
  Search,
  Share2,
  Webhook,
  X,
} from 'lucide-react';
import { useAzure } from '../context/AzureContext';
import {
  getApiCenterAsset,
  listApiCenterAssets,
  listApiCenterDeployments,
  listApiCenterVersions,
} from '../services/azure';
import type { ApiCenterCatalogResource } from '../types';

type RegistryTab = 'overview' | 'versions' | 'deployments';

interface AssetDetails {
  asset: ApiCenterCatalogResource;
  versions: ApiCenterCatalogResource[];
  deployments: ApiCenterCatalogResource[];
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function displayLabel(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function kindIcon(kind: string) {
  switch (kind.toLowerCase()) {
    case 'graphql': return <Share2 size={14} />;
    case 'grpc': return <Cable size={14} />;
    case 'soap': return <Code2 size={14} />;
    case 'webhook': return <Webhook size={14} />;
    case 'websocket': return <Radio size={14} />;
    default: return <Globe size={14} />;
  }
}

function ResourceList({ resources, emptyText }: { resources: ApiCenterCatalogResource[]; emptyText: string }) {
  if (resources.length === 0) return <div className="registry-empty-tab">{emptyText}</div>;

  return (
    <div className="registry-resource-list">
      {resources.map((resource) => (
        <article className="registry-resource-item" key={resource.id}>
          <div className="registry-resource-title">
            {displayValue(resource.properties.title ?? resource.properties.version ?? resource.name)}
          </div>
          <div className="registry-resource-meta">
            {resource.properties.lifecycleStage != null && (
              <span className="registry-lifecycle">{String(resource.properties.lifecycleStage)}</span>
            )}
            {resource.properties.environmentId != null && (
              <span>{displayValue(resource.properties.environmentId)}</span>
            )}
          </div>
          {resource.properties.description != null && (
            <p className="registry-resource-description">{String(resource.properties.description)}</p>
          )}
          <dl className="registry-resource-fields">
            {Object.entries(resource.properties)
              .filter(([key]) => !['title', 'version', 'lifecycleStage', 'environmentId', 'description'].includes(key))
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{displayLabel(key)}</dt>
                  <dd>{displayValue(value)}</dd>
                </div>
              ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

export default function Registry() {
  const { config, getCredential } = useAzure();
  const apiCenter = config.apiCenter;
  const [assets, setAssets] = useState<ApiCenterCatalogResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selectedAsset, setSelectedAsset] = useState<ApiCenterCatalogResource | null>(null);
  const [activeTab, setActiveTab] = useState<RegistryTab>('overview');
  const [details, setDetails] = useState<AssetDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    let active = true;
    if (!apiCenter) return;

    const loadAssets = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await listApiCenterAssets(getCredential(), apiCenter);
        if (active) setAssets(result);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load API Center assets.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadAssets();
    return () => { active = false; };
  }, [apiCenter, getCredential, refreshVersion]);

  useEffect(() => {
    if (!selectedAsset || !apiCenter) return;
    let active = true;
    const loadDetails = async () => {
      setDetails(null);
      setDetailsError(null);
      setDetailsLoading(true);
      try {
        const [asset, versions, deployments] = await Promise.all([
          getApiCenterAsset(getCredential(), apiCenter, selectedAsset.name),
          listApiCenterVersions(getCredential(), apiCenter, selectedAsset.name),
          listApiCenterDeployments(getCredential(), apiCenter, selectedAsset.name),
        ]);
        if (active) setDetails({ asset, versions, deployments });
      } catch (err) {
        if (active) setDetailsError(err instanceof Error ? err.message : 'Failed to load asset details.');
      } finally {
        if (active) setDetailsLoading(false);
      }
    };
    void loadDetails();
    return () => { active = false; };
  }, [apiCenter, getCredential, selectedAsset]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedAsset(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const types = [...new Set(assets.map((asset) => asset.properties.kind).filter((kind): kind is string => typeof kind === 'string'))].sort();
  const lifecycleStages = [...new Set(assets.map((asset) => asset.properties.lifecycleStage).filter((stage): stage is string => typeof stage === 'string'))].sort();
  const filteredAssets = assets.filter((asset) => {
    const title = displayValue(asset.properties.title ?? asset.name).toLowerCase();
    const summary = displayValue(asset.properties.summary ?? '').toLowerCase();
    const name = asset.name.toLowerCase();
    if (deferredSearch && !title.includes(deferredSearch) && !name.includes(deferredSearch) && !summary.includes(deferredSearch)) return false;
    if (typeFilter !== 'all' && asset.properties.kind !== typeFilter) return false;
    if (lifecycleFilter !== 'all' && asset.properties.lifecycleStage !== lifecycleFilter) return false;
    return true;
  });
  const pageCount = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleAssets = filteredAssets.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const openAsset = (asset: ApiCenterCatalogResource) => {
    setSelectedAsset(asset);
    setActiveTab('overview');
  };

  const resetFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setLifecycleFilter('all');
    setPage(0);
  };

  if (!config.apimService) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Registry</h1>
          <p className="page-description">Browse API assets in the API Center linked to your APIM instance.</p>
        </div>
        <div className="page-empty">
          <Library className="page-empty-icon" />
          <div className="page-empty-title">No APIM service selected</div>
          <p className="page-empty-text">Select an APIM instance to open its linked API Center registry.</p>
        </div>
      </div>
    );
  }

  if (!apiCenter) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h1 className="page-title">Registry</h1>
          <p className="page-description">Browse API assets in the API Center linked to your APIM instance.</p>
        </div>
        <div className="page-empty">
          <Library className="page-empty-icon" />
          <div className="page-empty-title">No API Center linked</div>
          <p className="page-empty-text">The selected APIM instance does not have a linked API Center resource.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container sub-page registry-page">
      <div className="page-header registry-header">
        <div>
          <h1 className="page-title">Registry</h1>
          <p className="page-description">API Center assets linked to {config.apimService.name}.</p>
        </div>
        <button
          className="icon-btn"
          onClick={() => setRefreshVersion((version) => version + 1)}
          title="Refresh registry"
          aria-label="Refresh registry"
          disabled={loading}
        >
          <RefreshCw size={15} className={loading ? 'registry-spinning' : ''} />
        </button>
      </div>

      <div className="sub-toolbar registry-toolbar">
        <label className="sub-search">
          <Search size={14} className="sub-search-icon" />
          <input
            type="search"
            placeholder="Search by name or summary"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            aria-label="Search registry assets"
          />
        </label>
        <div className="sub-filters">
          <select aria-label="Filter by asset type" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(0); }}>
            <option value="all">All types</option>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <select aria-label="Filter by lifecycle" value={lifecycleFilter} onChange={(event) => { setLifecycleFilter(event.target.value); setPage(0); }}>
            <option value="all">All lifecycle stages</option>
            {lifecycleStages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </div>
        <span className="registry-result-count">{filteredAssets.length} {filteredAssets.length === 1 ? 'asset' : 'assets'}</span>
      </div>

      {loading ? (
        <div className="page-empty"><span className="spinner" /></div>
      ) : error ? (
        <div className="registry-error" role="alert">
          <AlertCircle size={18} />
          <div><strong>Could not load API Center assets</strong><span>{error}</span></div>
          <button className="sub-btn-primary" onClick={() => setRefreshVersion((version) => version + 1)}>Retry</button>
        </div>
      ) : assets.length === 0 ? (
        <div className="page-empty">
          <Library className="page-empty-icon" />
          <div className="page-empty-title">No API assets found</div>
          <p className="page-empty-text">This API Center workspace does not contain any API assets yet.</p>
        </div>
      ) : filteredAssets.length === 0 ? (
        <div className="page-empty">
          <Search className="page-empty-icon" />
          <div className="page-empty-title">No matching assets</div>
          <p className="page-empty-text">Try another search or clear the selected filters.</p>
          <button className="sub-btn-secondary registry-reset" onClick={resetFilters}>Clear filters</button>
        </div>
      ) : (
        <>
          <div className="sub-table-wrap registry-table-wrap">
            <table className="sub-table registry-table">
              <thead>
                <tr><th>Asset title</th><th>Type</th><th>Lifecycle</th><th>Summary</th></tr>
              </thead>
              <tbody>
                {visibleAssets.map((asset) => {
                  const kind = displayValue(asset.properties.kind ?? 'API');
                  return (
                    <tr key={asset.id} className="sub-row" onClick={() => openAsset(asset)}>
                      <td className="sub-name-cell">
                        <button className="registry-asset-link" onClick={() => openAsset(asset)}>
                          <span className="registry-kind-icon">{kindIcon(kind)}</span>
                          {displayValue(asset.properties.title ?? asset.name)}
                        </button>
                      </td>
                      <td><span className="registry-type">{kind}</span></td>
                      <td><span className="registry-lifecycle">{displayValue(asset.properties.lifecycleStage)}</span></td>
                      <td className="registry-summary">{displayValue(asset.properties.summary ?? asset.properties.description)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="registry-pagination">
            <span>Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filteredAssets.length)} of {filteredAssets.length}</span>
            <label>Rows per page
              <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
                <option value={10}>10</option><option value={25}>25</option><option value={50}>50</option>
              </select>
            </label>
            <div className="registry-page-controls">
              <span>Page {currentPage + 1} of {pageCount}</span>
              <button className="icon-btn" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0} title="Previous page" aria-label="Previous page"><ChevronLeft size={15} /></button>
              <button className="icon-btn" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount - 1} title="Next page" aria-label="Next page"><ChevronRight size={15} /></button>
            </div>
          </div>
        </>
      )}

      {selectedAsset && (
        <div className="sub-panel-overlay" onClick={() => setSelectedAsset(null)}>
          <section className="sub-panel registry-panel" role="dialog" aria-modal="true" aria-labelledby="registry-detail-title" onClick={(event) => event.stopPropagation()}>
            <div className="sub-panel-header">
              <h2 id="registry-detail-title">{displayValue(selectedAsset.properties.title ?? selectedAsset.name)}</h2>
              <div className="registry-panel-actions">
                <a className="icon-btn" href={`https://portal.azure.com/#@/resource${selectedAsset.id}`} target="_blank" rel="noopener noreferrer" title="Open in Azure Portal" aria-label="Open asset in Azure Portal">
                  <img src="/azure.svg" alt="Azure" />
                </a>
                <button className="icon-btn" onClick={() => setSelectedAsset(null)} title="Close details" aria-label="Close details"><X size={16} /></button>
              </div>
            </div>
            <div className="registry-tabs" role="tablist" aria-label="Asset details">
              {(['overview', 'versions', 'deployments'] as const).map((tab) => (
                <button
                  key={tab}
                  id={`registry-tab-${tab}`}
                  className={`registry-tab${activeTab === tab ? ' active' : ''}`}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls="registry-tab-panel"
                  onClick={() => setActiveTab(tab)}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  {details && tab === 'versions' && <span>{details.versions.length}</span>}
                  {details && tab === 'deployments' && <span>{details.deployments.length}</span>}
                </button>
              ))}
            </div>
            <div className="sub-panel-body registry-panel-body" id="registry-tab-panel" role="tabpanel" aria-labelledby={`registry-tab-${activeTab}`}>
              {detailsLoading ? (
                <div className="page-empty"><span className="spinner spinner-sm" /></div>
              ) : detailsError ? (
                <div className="registry-detail-error" role="alert"><AlertCircle size={16} />{detailsError}</div>
              ) : !details ? null : activeTab === 'overview' ? (
                <div className="registry-overview">
                  <div className="registry-overview-heading">
                    <span className="registry-kind-icon">{kindIcon(displayValue(details.asset.properties.kind))}</span>
                    <div>
                      <strong>{displayValue(details.asset.properties.kind ?? 'API')}</strong>
                      <span>{displayValue(details.asset.properties.lifecycleStage ?? 'Lifecycle not set')}</span>
                    </div>
                  </div>
                  <div className="sub-panel-fields">
                    {Object.entries(details.asset.properties).map(([key, value]) => (
                      <div className="sub-panel-field" key={key}>
                        <label>{displayLabel(key)}</label>
                        <span className="registry-metadata-value">{displayValue(value)}</span>
                      </div>
                    ))}
                    {details.asset.systemData && Object.entries(details.asset.systemData).map(([key, value]) => (
                      <div className="sub-panel-field" key={`system-${key}`}>
                        <label>System · {displayLabel(key)}</label>
                        <span className="registry-metadata-value">{displayValue(value)}</span>
                      </div>
                    ))}
                    <div className="sub-panel-field">
                      <label>Resource ID</label>
                      <span className="registry-metadata-value registry-resource-id">{details.asset.id}</span>
                    </div>
                  </div>
                </div>
              ) : activeTab === 'versions' ? (
                <ResourceList resources={details.versions} emptyText="No versions are registered for this API." />
              ) : (
                <ResourceList resources={details.deployments} emptyText="No deployments are registered for this API." />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}