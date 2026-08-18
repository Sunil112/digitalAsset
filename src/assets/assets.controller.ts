import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { AssetActionDto } from './dto/asset-action.dto';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAsset(@Body() createAssetDto: CreateAssetDto) {
    return await this.assetsService.createAsset(createAssetDto);
  }

  @Get()
  async getAllAssets() {
    return await this.assetsService.getAllAssets();
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  async enableAsset(@Body() actionDto: AssetActionDto) {
    return await this.assetsService.enableAsset(actionDto.adminPartyId, actionDto.assetId);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disableAsset(@Body() actionDto: AssetActionDto) {
    return await this.assetsService.disableAsset(actionDto.adminPartyId, actionDto.assetId);
  }
}
