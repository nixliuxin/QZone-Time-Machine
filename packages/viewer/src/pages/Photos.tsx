import { useParams, useNavigate, Link } from 'react-router-dom';
import { useData } from '../hooks/useData';
import { usePagination } from '../hooks/usePagination';
import { CommentList } from '../components/CommentList';
import { Breadcrumb } from '../components/Breadcrumb';
import { Pagination } from '../components/Pagination';
import { formatDate, formatDateShort } from '../utils/format';

interface Album {
  id: string;
  name: string;
  className?: string;
  total?: number;
  cover_url?: string;
  custom_filepath?: string;
  createtime?: string;
  lastuploadtime?: string;
  modifytime?: number;
  desc?: string;
}

interface PhotoComment {
  content?: string;
  name?: string;
  nickname?: string;
  create_time?: number;
  custom_create_time?: string;
  replies?: PhotoComment[];
}

interface Photo {
  url?: string;
  custom_filepath?: string;
  custom_url?: string;
  name?: string;
  desc?: string;
  shoottime?: string | number;
  uploadtime?: string | number;
  width?: number;
  height?: number;
  lloc?: string;
  sloc?: string;
  poiName?: string;
  is_video?: boolean | number;
  video_url?: string;
  exif?: Record<string, string>;
  custom_filename?: string;
  photocubage?: number;
  origin_width?: number;
  origin_height?: number;
  comments?: PhotoComment[];
}

// ─── Album List (route: /photos) ───

export function PhotoAlbums() {
  const { data: albums, loading, error } = useData<Album[]>('./data/photos/albums.json');

  if (loading) return <div className="p-6 text-[hsl(var(--muted-foreground))]">加载中...</div>;
  if (error) return <div className="p-6 text-[hsl(var(--destructive))]">加载失败: {error}</div>;
  if (!albums?.length) return <div className="p-6 text-[hsl(var(--muted-foreground))]">暂无相册</div>;

  const groups = new Map<string, Album[]>();
  for (const album of albums) {
    const cls = album.className || '未分类';
    if (!groups.has(cls)) groups.set(cls, []);
    groups.get(cls)!.push(album);
  }

  return (
    <div className="p-6">
      <Breadcrumb />
      <h2 className="text-xl font-bold mb-6 text-[hsl(var(--foreground))]">相册 ({albums.length})</h2>

      <div className="space-y-10">
        {[...groups.entries()].map(([cls, albumsInGroup]) => (
          <section key={cls}>
            <div className="sticky top-0 z-10 bg-[hsl(var(--background))] py-3 mb-4 border-b-2 border-[hsl(var(--border))]">
              <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">{cls} <span className="text-sm font-normal text-[hsl(var(--muted-foreground))]">({albumsInGroup.length})</span></h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {albumsInGroup.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AlbumCard({ album }: { album: Album }) {
  const cover = album.cover_url || album.custom_filepath || '';
  const createDate = formatDateShort(album.createtime);

  return (
    <Link
      to={`/photos/${album.id}`}
      className="group text-left rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden shadow-sm hover:shadow-md hover:border-[hsl(var(--foreground)/0.2)] transition block"
    >
      <div className="aspect-square bg-[hsl(var(--muted))] overflow-hidden">
        {cover ? (
          <img src={cover} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl text-[hsl(var(--muted-foreground))]">📷</div>
        )}
      </div>
      <div className="p-3">
        <p className="font-medium text-sm truncate text-[hsl(var(--foreground))]">{album.name}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{album.total ?? 0} 张</span>
          {createDate && <span className="text-xs text-[hsl(var(--muted-foreground))]">{createDate}</span>}
        </div>
        {album.desc && <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 line-clamp-1">{album.desc}</p>}
      </div>
    </Link>
  );
}

// ─── Album Detail (route: /photos/:albumId) ───

export function PhotoAlbumDetail() {
  const { albumId } = useParams<{ albumId: string }>();
  const { data: albums } = useData<Album[]>('./data/photos/albums.json');
  const { data: photos, loading, error } = useData<Photo[]>(`./data/photos/${albumId}.json`);

  const album = albums?.find((a) => a.id === albumId);
  const albumName = album?.name || albumId || '';

  const breadcrumbExtra = [
    ...(album?.className ? [{ label: album.className }] : []),
    { label: albumName },
  ];

  return (
    <div className="p-6">
      <Breadcrumb extra={breadcrumbExtra} />
      <Link to="/photos" className="mb-3 inline-block text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition">&larr; 返回相册列表</Link>
      <h3 className="text-lg font-bold text-[hsl(var(--foreground))] mb-1">{albumName}</h3>
      {album?.desc && <p className="text-sm text-[hsl(var(--muted-foreground))] mb-1">{album.desc}</p>}
      <div className="flex gap-4 text-xs text-[hsl(var(--muted-foreground))] mb-4">
        {album?.createtime && <span>创建: {formatDateShort(album.createtime)}</span>}
        {album?.lastuploadtime && <span>最后上传: {formatDateShort(album.lastuploadtime)}</span>}
      </div>

      {loading ? (
        <div className="text-[hsl(var(--muted-foreground))]">加载中...</div>
      ) : error ? (
        <div className="text-[hsl(var(--muted-foreground))]">此相册暂无照片数据</div>
      ) : !photos?.length ? (
        <div className="text-[hsl(var(--muted-foreground))]">此相册为空</div>
      ) : (
        <PhotoGrid photos={photos} albumId={albumId!} />
      )}
    </div>
  );
}

function PhotoGrid({ photos, albumId }: { photos: Photo[]; albumId: string }) {
  const { paged: pagedPhotos, currentPage, totalPages, total: photoTotal, setPage, pageSize } = usePagination(photos, 60);

  const pageOffset = (currentPage - 1) * pageSize;

  return (
    <>
      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {pagedPhotos.map((photo, i) => (
          <PhotoThumb key={pageOffset + i} photo={photo} albumId={albumId} index={pageOffset + i} />
        ))}
      </div>
      <Pagination currentPage={currentPage} totalPages={totalPages} total={photoTotal} pageSize={pageSize} onPageChange={setPage} />
    </>
  );
}

function PhotoThumb({ photo, albumId, index }: { photo: Photo; albumId: string; index: number }) {
  const src = photo.url || photo.custom_filepath || photo.custom_url || '';
  if (!src) return null;

  const name = photo.name || '';
  const uploadStr = formatDateShort(photo.uploadtime);
  const shootStr = formatDateShort(photo.shoottime);

  return (
    <Link
      to={`/photos/${albumId}/${index}`}
      className="group relative rounded-lg overflow-hidden bg-[hsl(var(--muted))] border border-[hsl(var(--border))] hover:border-[hsl(var(--foreground)/0.3)] transition"
    >
      <div className="aspect-square overflow-hidden">
        <img src={src} alt={name} className="w-full h-full object-cover" loading="lazy" />
        {(photo.is_video === true || photo.is_video === 1) && (
          <div className="absolute top-2 right-2">
            <div className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center">
              <svg className="w-3 h-3 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </div>
          </div>
        )}
      </div>
      <div className="p-1.5 min-h-[2rem]">
        <p className="text-xs text-[hsl(var(--foreground))] truncate">{name || '未命名'}</p>
        {photo.desc && photo.desc !== photo.name && <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{photo.desc}</p>}
      </div>
      <div className="absolute inset-x-0 top-0 p-2 bg-gradient-to-b from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="text-xs text-white/90 space-y-0.5">
          <div>拍摄: {shootStr || '未知'}</div>
          <div>上传: {uploadStr || '未知'}</div>
          {photo.width && photo.height && <div>{photo.width}×{photo.height}</div>}
          {photo.poiName && <div>📍 {photo.poiName}</div>}
        </div>
      </div>
    </Link>
  );
}

// ─── Single Photo View (route: /photos/:albumId/:photoIndex) ───

export function PhotoView() {
  const { albumId, photoIndex } = useParams<{ albumId: string; photoIndex: string }>();
  const navigate = useNavigate();
  const { data: photos } = useData<Photo[]>(`./data/photos/${albumId}.json`);
  const { data: albums } = useData<Album[]>('./data/photos/albums.json');

  const album = albums?.find((a) => a.id === albumId);
  const idx = parseInt(photoIndex || '0', 10);
  const photo = photos?.[idx];
  const total = photos?.length || 0;

  if (!photo) {
    return (
      <div className="p-6">
        <Link to={`/photos/${albumId}`} className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">&larr; 返回相册</Link>
        <p className="mt-4 text-[hsl(var(--muted-foreground))]">照片不存在</p>
      </div>
    );
  }

  const src = photo.url || photo.custom_filepath || photo.custom_url || '';
  const name = photo.name || photo.desc || '';
  const filename = photo.custom_filename || src.split('/').pop() || '';
  const filesize = photo.photocubage ? formatFileSize(photo.photocubage) : '';
  const location = photo.poiName || '';
  const dimensions = (photo.origin_width && photo.origin_height)
    ? `${photo.origin_width} × ${photo.origin_height}`
    : (photo.width && photo.height) ? `${photo.width} × ${photo.height}` : '';
  const comments = photo.comments || [];

  const goPrev = () => { if (idx > 0) navigate(`/photos/${albumId}/${idx - 1}`, { replace: true }); };
  const goNext = () => { if (idx < total - 1) navigate(`/photos/${albumId}/${idx + 1}`, { replace: true }); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
    else if (e.key === 'Escape') navigate(`/photos/${albumId}`);
  };

  const exifEntries = photo.exif ? Object.entries(photo.exif).filter(([, v]) => v && v.trim()) : [];

  return (
    <div className="flex h-full" onKeyDown={handleKeyDown} tabIndex={0} ref={(el) => el?.focus()}>
      {/* Left: Image */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between p-3 border-b border-[hsl(var(--border))]">
          <Link to={`/photos/${albumId}`} className="text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]">&larr; {album?.name || '相册'}</Link>
          <div className="flex items-center gap-2">
            <button onClick={goPrev} disabled={idx === 0} className="px-2 py-1 text-xs rounded border border-[hsl(var(--border))] disabled:opacity-30 hover:bg-[hsl(var(--accent))] transition">◀</button>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">{idx + 1}/{total}</span>
            <button onClick={goNext} disabled={idx >= total - 1} className="px-2 py-1 text-xs rounded border border-[hsl(var(--border))] disabled:opacity-30 hover:bg-[hsl(var(--accent))] transition">▶</button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center bg-black/5 dark:bg-black/40 p-4 min-h-0">
          <img src={src} alt={name} className="max-w-full max-h-full object-contain rounded shadow-lg" />
        </div>
      </div>

      {/* Right: Info panel */}
      <aside className="w-80 shrink-0 border-l border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-y-auto p-4 space-y-4">
        <div>
          <h4 className="font-medium text-sm text-[hsl(var(--foreground))] break-words">{name || '未命名'}</h4>
          {photo.desc && photo.desc !== photo.name && photo.desc.trim() && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1 break-words">{photo.desc}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <InfoRow label="拍摄" value={formatDate(photo.shoottime) || '未知'} />
          <InfoRow label="上传" value={formatDate(photo.uploadtime) || '未知'} />
          {dimensions && <InfoRow label="尺寸" value={dimensions} />}
          {filename && <InfoRow label="文件" value={filename} />}
          {filesize && <InfoRow label="大小" value={filesize} />}
          {location && <InfoRow label="位置" value={location} />}
        </div>

        {exifEntries.length > 0 && (
          <div>
            <h5 className="text-xs font-semibold text-[hsl(var(--foreground))] mb-2 uppercase tracking-wide">EXIF</h5>
            <div className="space-y-1">
              {exifEntries.map(([k, v]) => (
                <InfoRow key={k} label={k} value={v} />
              ))}
            </div>
          </div>
        )}

        {comments.length > 0 && (
          <div>
            <h5 className="text-xs font-semibold text-[hsl(var(--foreground))] mb-2">评论 ({comments.length})</h5>
            <CommentList comments={comments} />
          </div>
        )}
      </aside>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="text-xs leading-relaxed">
      <span className="text-[hsl(var(--muted-foreground))]">{label}：</span>
      <span className="text-[hsl(var(--foreground))] break-words">{value}</span>
    </div>
  );
}
