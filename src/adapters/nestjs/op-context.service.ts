import { Injectable } from '@nestjs/common';

import { OpContext } from '../../core/op-context.service';

@Injectable()
export class OpContextService extends OpContext {}
