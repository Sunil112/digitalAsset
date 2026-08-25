import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

describe('AssetsController', () => {
  let controller: AssetsController;
  let assetsService: Pick<AssetsService, 'createAsset' | 'getAllAssets' | 'enableAsset' | 'disableAsset'>;

  beforeEach(() => {
    assetsService = {
      createAsset: jest.fn().mockResolvedValue({ id: 'asset-1' }),
      getAllAssets: jest.fn().mockResolvedValue([{ id: 'asset-1' }]),
      enableAsset: jest.fn().mockResolvedValue({ id: 'asset-1', status: 'ENABLED' }),
      disableAsset: jest.fn().mockResolvedValue({ id: 'asset-1', status: 'DISABLED' }),
    } as any;

    controller = new AssetsController(assetsService as AssetsService);
  });

  it('creates an asset', async () => {
    const result = await controller.createAsset({ adminPartyId: 'EY', assetId: 'asset-001' } as any);

    expect(assetsService.createAsset).toHaveBeenCalledWith({ adminPartyId: 'EY', assetId: 'asset-001' });
    expect(result).toEqual({ id: 'asset-1' });
  });

  it('lists assets', async () => {
    const result = await controller.getAllAssets();

    expect(assetsService.getAllAssets).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'asset-1' }]);
  });

  it('enables an asset', async () => {
    const result = await controller.enableAsset({ adminPartyId: 'EY', assetId: 'asset-001' });

    expect(assetsService.enableAsset).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result).toEqual({ id: 'asset-1', status: 'ENABLED' });
  });

  it('disables an asset', async () => {
    const result = await controller.disableAsset({ adminPartyId: 'EY', assetId: 'asset-001' });

    expect(assetsService.disableAsset).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result).toEqual({ id: 'asset-1', status: 'DISABLED' });
  });
});
