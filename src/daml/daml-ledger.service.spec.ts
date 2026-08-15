import { DamlService } from './daml-ledger.service';
import { InternalServerErrorException } from '@nestjs/common';

describe('DamlService template id resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      DAML_ENABLED: 'true',
      DAML_JSON_API_URL: 'http://localhost:7575',
      DAML_REQUEST_TIMEOUT_MS: '1000',
      DAML_JSON_API_TOKEN: 'token',
      DAML_ADMIN_PARTY: 'Admin',
      DAML_JWT_SECRET: 'secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it('converts dot template ids to packageId:Module:Entity for query calls', async () => {
    const service = new DamlService();

    const getSpy = jest
      .spyOn<any, any>(service as any, 'get')
      .mockResolvedValueOnce(['pkg-1']);
    const postSpy = jest
      .spyOn<any, any>(service as any, 'post')
      .mockResolvedValueOnce({ status: 200, result: [] });

    const result = await (service as any).query('Common.Registry.AssetPermission', { admin: 'A', assetId: 'asset-001' }, undefined);

    expect(result).toEqual([]);
    expect(getSpy).toHaveBeenNthCalledWith(1, 'v1/packages');
    expect(postSpy).toHaveBeenCalledWith(
      'v1/query',
      {
        templateIds: ['pkg-1:Common.Registry:AssetPermission'],
        query: { admin: 'A', assetId: 'asset-001' },
      },
      undefined,
    );
  });

  it('tries next package id when template cannot be resolved in the first package', async () => {
    const service = new DamlService();

    jest
      .spyOn<any, any>(service as any, 'get')
      .mockResolvedValueOnce(['bad-pkg', 'good-pkg']);

    const postSpy = jest
      .spyOn<any, any>(service as any, 'post')
      .mockRejectedValueOnce(
        new InternalServerErrorException(
          'DAML request returned an error payload: status=400; errors=Cannot resolve any template ID from request',
        ),
      )
      .mockResolvedValueOnce({ status: 200, result: [] });

    const result = await (service as any).query('Common.Registry.AssetPermission', { admin: 'A', assetId: 'asset-001' }, undefined);

    expect(result).toEqual([]);
    expect(postSpy).toHaveBeenNthCalledWith(
      1,
      'v1/query',
      {
        templateIds: ['bad-pkg:Common.Registry:AssetPermission'],
        query: { admin: 'A', assetId: 'asset-001' },
      },
      undefined,
    );
    expect(postSpy).toHaveBeenNthCalledWith(
      2,
      'v1/query',
      {
        templateIds: ['good-pkg:Common.Registry:AssetPermission'],
        query: { admin: 'A', assetId: 'asset-001' },
      },
      undefined,
    );
  });

  it('formats DAML error payload details for diagnostics', () => {
    const service = new DamlService();

    const message = (service as any).buildDamlErrorMessage({
      status: 400,
      errors: ['Invalid argument', 'Unknown template'],
      ledgerApiError: {
        code: 7,
        message: 'Request rejected',
      },
    });

    expect(message).toContain('status=400');
    expect(message).toContain('ledgerCode=7');
    expect(message).toContain('ledgerMessage=Request rejected');
    expect(message).toContain('errors=Invalid argument | Unknown template');
  });
});
