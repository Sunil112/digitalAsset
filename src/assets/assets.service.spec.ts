jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(undefined),
    mkdir: jest.fn().mockResolvedValue(undefined),
  },
}));

import { DamlService } from '../daml/daml-ledger.service';
import { AssetsService } from './assets.service';
import { AssetStatus } from './types/asset.types';

describe('AssetsService', () => {
  it('creates an asset and skips DAML sync when DAML is disabled', async () => {
    const damlLedgerService = {
      isEnabled: jest.fn().mockReturnValue(false),
      createAssetDirectory: jest.fn(),
      enableAsset: jest.fn(),
      disableAsset: jest.fn(),
    } as unknown as DamlService;

    const service = new AssetsService(damlLedgerService);

    const result = await service.createAsset({
      adminPartyId: 'EY',
      assetId: 'asset-001',
    });

    expect(damlLedgerService.createAssetDirectory).not.toHaveBeenCalled();
    expect(result.status).toBe(AssetStatus.DISABLED);
    expect(result.enabled).toBe(false);
    expect(result.metadata?.damlSyncStatus).toBe('SKIPPED');
  });

  it('enables an asset and syncs with DAML', async () => {
    const damlLedgerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      createAssetDirectory: jest.fn().mockResolvedValue({ contractId: 'asset-dir-1', payload: { enabled: false } }),
      enableAsset: jest.fn().mockResolvedValue('asset-dir-2'),
      disableAsset: jest.fn(),
    } as unknown as DamlService;

    const service = new AssetsService(damlLedgerService);

    await service.createAsset({
      adminPartyId: 'EY',
      assetId: 'asset-001',
    });

    const result = await service.enableAsset('EY', 'asset-001');

    expect(damlLedgerService.enableAsset).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result.status).toBe(AssetStatus.ENABLED);
    expect(result.enabled).toBe(true);
    expect(result.damlContractId).toBe('asset-dir-2');
    expect(result.metadata?.damlSyncStatus).toBe('SYNCED');
  });

  it('disables an enabled asset and syncs with DAML', async () => {
    const damlLedgerService = {
      isEnabled: jest.fn().mockReturnValue(true),
      createAssetDirectory: jest.fn().mockResolvedValue({ contractId: 'asset-dir-1', payload: { enabled: false } }),
      enableAsset: jest.fn().mockResolvedValue('asset-dir-2'),
      disableAsset: jest.fn().mockResolvedValue('asset-dir-3'),
    } as unknown as DamlService;

    const service = new AssetsService(damlLedgerService);

    await service.createAsset({
      adminPartyId: 'EY',
      assetId: 'asset-001',
    });
    await service.enableAsset('EY', 'asset-001');

    const result = await service.disableAsset('EY', 'asset-001');

    expect(damlLedgerService.disableAsset).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result.status).toBe(AssetStatus.DISABLED);
    expect(result.enabled).toBe(false);
    expect(result.damlContractId).toBe('asset-dir-3');
    expect(result.metadata?.damlSyncStatus).toBe('SYNCED');
  });
});
