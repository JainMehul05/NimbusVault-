import { render, screen } from '@testing-library/react';
import { ActivityItem } from './ActivityItem';
import type { ActivityLogEntry } from '@services/activity';

const entry = (over: Partial<ActivityLogEntry>): ActivityLogEntry => ({
  id: '1',
  userId: 'u1',
  action: 'file_upload',
  resourceType: 'FILE',
  resourceId: 'f1',
  ipAddress: null,
  metadata: null,
  createdAt: new Date().toISOString(),
  user: { id: 'u1', name: 'Alice', email: 'a@x.test' },
  performedByYou: true,
  ...over,
});

const renderItem = (e: ActivityLogEntry) => render(<ul><ActivityItem entry={e} /></ul>);

describe('ActivityItem', () => {
  it('describes uploads, folder renames and permission updates distinctly', () => {
    renderItem(entry({ action: 'file_upload', metadata: { filename: 'plan.pdf' } }));
    expect(screen.getByText(/Uploaded/)).toHaveTextContent('Uploaded plan.pdf');

    renderItem(entry({ action: 'folder_rename', resourceType: 'FOLDER', metadata: { oldName: 'Old', newName: 'New' } }));
    expect(screen.getByText(/Renamed folder/)).toHaveTextContent('Renamed folder Old to New');

    renderItem(entry({ action: 'share_update', metadata: { name: 'doc.txt', level: 'EDITOR', previousLevel: 'VIEWER' } }));
    expect(screen.getByText(/Changed someone’s access/)).toHaveTextContent('from Viewer to Editor');

    renderItem(entry({ action: 'share_revoke', metadata: { name: 'doc.txt', previousLevel: 'VIEWER' } }));
    expect(screen.getByText(/Removed someone’s access/)).toBeInTheDocument();
  });

  it('attributes events to other users and anonymous share-link visitors', () => {
    renderItem(entry({ action: 'file_download', userId: 'u2', user: { id: 'u2', name: 'Bob', email: 'b@x.test' }, performedByYou: false, metadata: { filename: 'x.txt' } }));
    expect(screen.getByText('by Bob')).toBeInTheDocument();

    renderItem(entry({ action: 'share_access', userId: null, user: null, performedByYou: false, anonymous: true, resourceType: 'SHARE_LINK', metadata: { filename: 'x.txt' } }));
    expect(screen.getByText('by a share-link visitor')).toBeInTheDocument();
  });

  it('only shows an IP address the API chose to return', () => {
    renderItem(entry({ ipAddress: null }));
    expect(screen.queryByText(/\d+\.\d+\.\d+\.\d+/)).not.toBeInTheDocument();
  });
});
