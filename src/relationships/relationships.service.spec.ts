import { promises as fs } from 'fs';
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { RelationshipsService } from './relationships.service';
import { DamlService } from '../daml/daml-ledger.service';

describe('RelationshipsService', () => {
  it('creates and retrieves relationships', async () => {
    const damlService = { isEnabled: jest.fn().mockReturnValue(false) } as unknown as DamlService;
    const service = new RelationshipsService(damlService);
    const created = await service.createRelationship({ fromPartyId: 'p1', toPartyId: 'p2', relationshipType: 'HOLDER' } as any);
    expect(created).toHaveProperty('id');

    const all = await service.getAllRelationships();
    expect(all.find((r) => r.id === created.id)).toBeDefined();
  });

  it('does not create duplicate active relationships for the same key', async () => {
    const damlService = { isEnabled: jest.fn().mockReturnValue(false) } as unknown as DamlService;
    const service = new RelationshipsService(damlService);

    const dto = {
      fromPartyId: 'EY',
      toPartyId: 'CITI',
      relationshipType: 'ISSUER',
      assetId: 'asset-001',
      metadata: { note: 'Granting role' },
    } as any;

    const first = await service.createRelationship(dto);
    const second = await service.createRelationship(dto);

    expect(second.id).toEqual(first.id);

    const all = await service.getAllRelationships();
    expect(all).toHaveLength(1);
  });

  it('retries DAML sync for an existing LOCAL_ONLY relationship', async () => {
    const allowIssuer = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary DAML failure'))
      .mockResolvedValueOnce('contract-123');

    const damlService = {
      isEnabled: jest.fn().mockReturnValue(true),
      allowIssuer,
      allowHolder: jest.fn(),
    } as unknown as DamlService;

    const service = new RelationshipsService(damlService);

    const dto = {
      fromPartyId: 'EY',
      toPartyId: 'CITI',
      relationshipType: 'ISSUER',
      assetId: 'asset-001',
      metadata: { note: 'Granting role' },
    } as any;

    const first = await service.createRelationship(dto);
    expect(first.metadata?.damlSyncStatus).toBe('LOCAL_ONLY');

    const second = await service.createRelationship(dto);
    expect(second.id).toEqual(first.id);
    expect(second.metadata?.damlSyncStatus).toBe('SYNCED');
    expect(second.metadata?.damlSyncError).toBeUndefined();
    expect(second.damlContractId).toBe('contract-123');

    const all = await service.getAllRelationships();
    expect(all).toHaveLength(1);
    expect(allowIssuer).toHaveBeenCalledTimes(2);
  });
});
