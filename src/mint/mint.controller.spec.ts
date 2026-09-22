import { MintController } from './mint.controller';
import { MintService } from './mint.service';
import { MintStatus } from './types/mint.types';

const baseMint = {
  id: 'mint-1',
  adminPartyId: 'EY',
  assetId: 'asset-001',
  issuerPartyId: 'Issuer',
  targetOwnerPartyId: 'Alice',
  qty: 100,
  status: MintStatus.PENDING,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('MintController', () => {
  let controller: MintController;
  let mintService: Pick<MintService, 'createMintRequest' | 'getAllMintRequests' | 'approveMintRequest' | 'cancelMintRequest'>;

  beforeEach(() => {
    mintService = {
      createMintRequest: jest.fn().mockResolvedValue(baseMint),
      getAllMintRequests: jest.fn().mockResolvedValue([baseMint]),
      approveMintRequest: jest.fn().mockResolvedValue({ ...baseMint, status: MintStatus.APPROVED }),
      cancelMintRequest: jest.fn().mockResolvedValue({ ...baseMint, status: MintStatus.CANCELLED }),
    } as any;

    controller = new MintController(mintService as MintService);
  });

  it('creates a mint request', async () => {
    const dto = { adminPartyId: 'EY', assetId: 'asset-001', issuerPartyId: 'Issuer', targetOwnerPartyId: 'Alice', qty: 100 };
    const result = await controller.createMintRequest(dto as any);

    expect(mintService.createMintRequest).toHaveBeenCalledWith(dto);
    expect(result).toEqual(baseMint);
  });

  it('lists mint requests with no filters', async () => {
    const result = await controller.listMintRequests();

    expect(mintService.getAllMintRequests).toHaveBeenCalledWith(undefined, undefined);
    expect(result).toEqual([baseMint]);
  });

  it('lists mint requests filtered by adminPartyId and assetId', async () => {
    const result = await controller.listMintRequests('EY', 'asset-001');

    expect(mintService.getAllMintRequests).toHaveBeenCalledWith('EY', 'asset-001');
    expect(result).toEqual([baseMint]);
  });

  it('approves a mint request', async () => {
    const dto = { adminPartyId: 'EY', issuerPartyId: 'Issuer', mintRequestId: 'mint-1' };
    const result = await controller.approveMintRequest(dto as any);

    expect(mintService.approveMintRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(MintStatus.APPROVED);
  });

  it('cancels a mint request', async () => {
    const dto = { issuerPartyId: 'Issuer', mintRequestId: 'mint-1' };
    const result = await controller.cancelMintRequest(dto as any);

    expect(mintService.cancelMintRequest).toHaveBeenCalledWith(dto);
    expect(result.status).toBe(MintStatus.CANCELLED);
  });
});
