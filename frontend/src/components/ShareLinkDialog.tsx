import React, { useState, useEffect } from 'react';
import { X, Link2, Copy, Check, Loader2, Trash2, Clock, Lock, AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from '@lib/utils';
import { useShareLinks } from '@hooks/useShareLinks';

interface ShareLinkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
}

export const ShareLinkDialog: React.FC<ShareLinkDialogProps> = ({
  isOpen,
  onClose,
  fileId,
  fileName,
}) => {
  const {
    error,
    shareLinks,
    createShareLink,
    listShareLinks,
    revokeShareLink,
    clearError,
  } = useShareLinks();

  const [permission, setPermission] = useState<'VIEW' | 'DOWNLOAD'>('VIEW');
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [newLink, setNewLink] = useState<{ token: string; url: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setNewLink(null);
      setCopiedId(null);
      setRevokingId(null);
      clearError();
      listShareLinks(fileId);
    }
  }, [isOpen, fileId, listShareLinks, clearError]);

  const handleCreateShareLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const result = await createShareLink({
        fileId,
        permission,
        password: password || undefined,
        expiresAt: expiresAt || undefined,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : undefined,
      });
      if (result) {
        setNewLink({ token: result.token, url: result.url });
        setPassword('');
        setExpiresAt('');
        setMaxDownloads('');
        listShareLinks(fileId);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevoke = async (shareLinkId: string) => {
    if (!window.confirm('Are you sure you want to revoke this share link?')) return;
    setRevokingId(shareLinkId);
    try {
      await revokeShareLink(shareLinkId);
      listShareLinks(fileId);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopy = (url: string, id: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  const isExpired = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const isRevoked = (dateStr: string | null) => {
    return dateStr !== null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg border border-border w-full max-w-2xl overflow-hidden animate-slide-in max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Share Link for {fileName}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto">
          {/* Create Share Link Form */}
          <div className="mb-6 p-4 bg-muted/30 rounded-lg">
            <h3 className="text-sm font-medium text-foreground mb-3">Create New Share Link</h3>
            <form onSubmit={handleCreateShareLink} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Permission</label>
                  <select
                    value={permission}
                    onChange={(e) => setPermission(e.target.value as 'VIEW' | 'DOWNLOAD')}
                    disabled={isLoading}
                    className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="VIEW">View Only</option>
                    <option value="DOWNLOAD">View & Download</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Expires At (Optional)</label>
                  <Input
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Password (Optional)</label>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Optional password"
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">Max Downloads (Optional)</label>
                  <Input
                    type="number"
                    value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    placeholder="e.g. 5"
                    min="1"
                    disabled={isLoading}
                  />
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                  Create Share Link
                </Button>
              </div>
            </form>
          </div>

          {/* Success Message with Link */}
          {newLink && (
            <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <p className="text-sm font-medium text-green-400 mb-2">Share link created!</p>
              <div className="flex items-center space-x-2">
                <Input
                  value={newLink.url}
                  readOnly
                  className="flex-1 bg-muted"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(newLink.url, 'new')}
                >
                  {copiedId === 'new' ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Copy this link to share. The token will not be shown again.</p>
            </div>
          )}

          {/* Existing Share Links */}
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Existing Share Links</h3>
            {shareLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No share links yet</p>
            ) : (
              <div className="space-y-2">
                {shareLinks.map((link) => (
                  <div
                    key={link.id}
                    className={cn(
                      'p-3 rounded-lg border flex items-center justify-between gap-2',
                      isRevoked(link.revokedAt) || isExpired(link.expiresAt)
                        ? 'border-destructive/30 bg-destructive/5 opacity-75'
                        : 'border-border bg-muted/30'
                    )}
                  >
                    <div className="flex-1 min-w-0 flex flex-col space-y-1">
                      <div className="flex items-center space-x-2 flex-wrap">
                        <span className={cn(
                          'px-2 py-0.5 text-xs rounded font-medium',
                          link.permission === 'DOWNLOAD'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground'
                        )}>
                          {link.permission}
                        </span>
                        {link.passwordHash && (
                          <span className="px-2 py-0.5 text-xs rounded bg-amber/10 text-amber-500 flex items-center gap-1">
                            <Lock className="w-3 h-3" /> Password Protected
                          </span>
                        )}
                        {link.maxDownloads && (
                          <span className="px-2 py-0.5 text-xs rounded bg-blue/10 text-blue-500">
                            Max: {link.maxDownloads} ({link.downloadCount} used)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Expires: {formatDate(link.expiresAt)}
                        </span>
                        {isRevoked(link.revokedAt) && (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertTriangle className="w-3 h-3" /> Revoked
                          </span>
                        )}
                        {isExpired(link.expiresAt) && !isRevoked(link.revokedAt) && (
                          <span className="flex items-center gap-1 text-amber-500">
                            <AlertTriangle className="w-3 h-3" /> Expired
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {!isRevoked(link.revokedAt) && !isExpired(link.expiresAt) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(`http://localhost:5173/share/${link.token}`, link.id)}
                        >
                          {copiedId === link.id ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => handleRevoke(link.id)}
                        disabled={revokingId === link.id}
                      >
                        {revokingId === link.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};