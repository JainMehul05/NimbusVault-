import React, { useState, useEffect } from 'react';
import { X, Users, Share2, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from '@lib/utils';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: 'FILE' | 'FOLDER';
  resourceId: string;
  resourceName: string;
  onShare: (granteeEmail: string, level: 'VIEWER' | 'EDITOR') => Promise<void>;
  existingShares?: Array<{
    id: string;
    grantee: { id: string; name: string; email: string };
    level: 'VIEWER' | 'EDITOR';
  }>;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
  isOpen,
  onClose,
  resourceType,
  resourceId: _resourceId,
  resourceName,
  onShare,
  existingShares = [],
}) => {
  const [granteeEmail, setGranteeEmail] = useState('');
  const [level, setLevel] = useState<'VIEWER' | 'EDITOR'>('VIEWER');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setGranteeEmail('');
      setLevel('VIEWER');
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!granteeEmail.trim()) {
      setError('Please enter an email address');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await onShare(granteeEmail, level);
      onClose();
    } catch (err) {
      setError('Failed to share');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-lg border border-border w-full max-w-md overflow-hidden animate-slide-in">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Share {resourceType === 'FILE' ? 'File' : 'Folder'}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-4">
            Share <strong className="text-foreground">{resourceName}</strong> with a registered user.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                User Email
              </label>
              <Input
                type="email"
                value={granteeEmail}
                onChange={(e) => setGranteeEmail(e.target.value)}
                placeholder="user@company.com"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Permission Level
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as 'VIEWER' | 'EDITOR')}
                disabled={isLoading}
                className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="VIEWER">Viewer - Can view and download</option>
                <option value="EDITOR">Editor - Can view, download, rename, move, and share</option>
              </select>
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div className="flex justify-end space-x-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={isLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading || !granteeEmail.trim()}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4 mr-2" />}
                Share
              </Button>
            </div>
          </form>

          {existingShares.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground mb-3">Current Shares</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {existingShares.map((share) => (
                  <div key={share.grantee.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                    <div className="flex items-center space-x-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{share.grantee.name}</p>
                        <p className="text-xs text-muted-foreground">{share.grantee.email}</p>
                      </div>
                    </div>
                    <span className={cn(
                      'px-2 py-0.5 text-xs rounded',
                      share.level === 'EDITOR'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {share.level}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};