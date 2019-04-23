/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { codemodel, processCodeModel, allVirtualParameters, allVirtualProperties, ModelState } from '@microsoft.azure/autorest.codemodel-v3';
import { Host, Channel } from '@microsoft.azure/autorest-extension-base';
import { values } from '@microsoft.azure/codegen';
import { CommandOperation } from '@microsoft.azure/autorest.codemodel-v3/dist/code-model/command-operation';

type State = ModelState<codemodel.Model>;

let directives: Array<any> = [];

interface WhereCommandDirective {
  select?: string;
  where: {
    'subject'?: string;
    'subject-prefix'?: string;
    'verb'?: string;
    'variant'?: string;
    'parameter-name'?: string;
  };
  set: {
    'subject'?: string;
    'subject-prefix'?: string;
    'verb'?: string;
    'variant'?: string;
    'hidden'?: Boolean;
    'parameter-name'?: string;
    'parameter-description'?: string;
  };
}

interface WhereEnumDirective {
  select?: string;
  where: {
    'enum-name'?: string;
    'enum-value-name'?: string;
  };
  set: {
    'enum-name'?: string;
    'enum-value-name'?: string;
  };
}

interface WhereModelDirective {
  select?: string;
  where: {
    'model-name'?: string;
    'property-name'?: string;
  };
  set: {
    'model-name'?: string;
    'property-name'?: string;
    'property-description'?: string;
  };
}

function isWhereCommandDirective(it: any): it is WhereCommandDirective {
  const directive = it;
  const select = directive.select;
  const where = directive.where;
  const set = directive.set;
  if ((where && set) || (where && set && (select === undefined || select === 'command' || select === 'parameter'))) {
    // just let the subject-prefix to be an empty string
    if ((set['parameter-name'] || set.hidden || set.subject || set["parameter-description"] || set.verb || set.variant || set['subject-prefix'] !== undefined)
      && (where.verb || where.variant || where["parameter-name"] || where.subject || where['subject-prefix'])) {
      let error = where['model-name'] ? `Can't select model and command at the same time.` : ``;
      error += where['property-name'] ? `Can't select property and command at the same time.` : ``;
      error += set['property-name'] ? `Can't set a property-name when a command is selected.` : ``;
      error += set['property-description'] ? `Can't set a property-description when a command is selected.` : ``;
      error += set['model-name'] ? `Can't set a model-name when a command is selected.` : ``;
      if (error) {
        throw Error(`Incorrect Directive: ${JSON.stringify(it, null, 2)}. Reason: ${error}.`);
      }

      return true;
    }
  }

  return false;
}

function isWhereModelDirective(it: any): it is WhereModelDirective {
  const directive = it;
  const select = directive.select;
  const where = directive.where;
  const set = directive.set;
  if ((where && set) || (where && set && (select === 'model' || select === 'property'))) {
    if ((set["model-name"] || set["property-description"] || set["property-name"])
      && (where['model-name'] || where['property-name'])) {
      let error = where['subject'] || where['subject-prefix'] || where['verb'] || where['variant'] ? `Can't select model and command at the same time.` : ``;
      error += where['parameter-name'] ? `Can't select a parameter and command at the same time.` : ``;
      error += set['subject'] ? `Can't set command subject when a model is selected.` : ``;
      error += set['subject-prefix'] ? `Can't set command subject-prefix when a model is selected.` : ``;
      error += set['verb'] ? `Can't set command verb when a model is selected.` : ``;
      error += set['variant'] ? `Can't set command variant when a model is selected.` : ``;
      error += set['hidden'] ? `Can't hide a command when a model is selected.` : ``;
      error += set['variant'] ? `Can't set a variant name when a model is selected.` : ``;
      if (error) {
        throw Error(`Incorrect Directive: ${JSON.stringify(it, null, 2)}.Reason: ${error}.`);
      }

      return true;
    }
  }
  return false;
}

function isWhereEnumDirective(it: any): it is WhereEnumDirective {
  const directive = it;
  const select = directive.select;
  const where = directive.where;
  const set = directive.set;
  if ((where && set) || (where && set && select === 'enum')) {
    if ((set["enum-name"] || set["enum-value-name"])
      && (where['enum-name'] || where['enum-value-name'])) {
      const setKeys = Object.keys(set);
      const whereKeys = Object.keys(where);
      let error =
        (
          setKeys.filter(each => each !== 'enum-name' && each !== 'enum-value-name').length > 0 ||
          whereKeys.filter(each => each !== 'enum-name' && each !== 'enum-value-name').length > 0
        ) ? `Incompatible selectors and modifiers. Make sure you are not using model, enum and command modifiers at the same time.` : '';

      if (error) {
        throw Error(`Incorrect Directive: ${JSON.stringify(it, null, 2)}. Reason: ${error}.`);
      }

      return true;
    }
  }
  return false;
}


export async function cosmeticModifier(service: Host) {
  directives = values(await service.GetValue('directive'))
    .linq.select(directive => directive)
    .linq.where(directive => isWhereCommandDirective(directive) || isWhereModelDirective(directive) || isWhereEnumDirective(directive))
    .linq.toArray();

  return processCodeModel(tweakModel, service);
}

async function tweakModel(state: State): Promise<codemodel.Model> {

  for (const directive of directives) {
    const getParsedSelector = (selector: string | undefined): RegExp | undefined => {
      return selector ? isNotRegex(selector) ? new RegExp(`^${selector}$`, 'gi') : new RegExp(selector, 'gi') : undefined;
    }

    if (isWhereCommandDirective(directive)) {
      const selectType = directive.select;
      const subjectRegex = getParsedSelector(directive.where['subject']);
      const subjectPrefixRegex = getParsedSelector(directive.where['subject-prefix']);
      const verbRegex = getParsedSelector(directive.where.verb);
      const variantRegex = getParsedSelector(directive.where.variant);
      const parameterRegex = getParsedSelector(directive.where["parameter-name"]);

      const subjectReplacer = directive.set['subject'];
      const subjectPrefixReplacer = directive.set['subject-prefix'];
      const verbReplacer = directive.set.verb;
      const variantReplacer = directive.set.variant;
      const parameterReplacer = directive.set["parameter-name"];
      const paramDescriptionReplacer = directive.set["parameter-description"];

      // select all operations
      let operations: Array<CommandOperation> = values(state.model.commands.operations).linq.toArray();
      if (subjectRegex) {
        operations = values(operations)
          .linq.where(operation =>
            !!`${operation.details.csharp.subject}`.match(subjectRegex))
          .linq.toArray();
      }

      if (subjectPrefixRegex) {
        operations = values(operations)
          .linq.where(operation =>
            !!`${operation.details.csharp.subjectPrefix}`.match(subjectPrefixRegex))
          .linq.toArray();
      }

      if (verbRegex) {
        operations = values(operations)
          .linq.where(operation =>
            !!`${operation.details.csharp.verb}`.match(verbRegex))
          .linq.toArray();
      }

      if (variantRegex) {
        operations = values(operations)
          .linq.where(operation =>
            !!`${operation.details.csharp.name}`.match(variantRegex))
          .linq.toArray();
      }

      if (parameterRegex && selectType === 'command') {
        operations = values(operations)
          .linq.where(operation => values(allVirtualParameters(operation.details.csharp.virtualParameters))
            .linq.any(parameter => !!`${parameter.name}`.match(parameterRegex)))
          .linq.toArray();
      }

      if (parameterRegex && (selectType === undefined || selectType === 'parameter')) {
        const parameters = values(operations)
          .linq.selectMany(operation => allVirtualParameters(operation.details.csharp.virtualParameters))
          .linq.where(parameter => !!`${parameter.name}`.match(parameterRegex))
          .linq.toArray();
        for (const parameter of parameters) {
          const prevName = parameter.name;
          parameter.name = parameterReplacer ? parameterRegex ? parameter.name.replace(parameterRegex, parameterReplacer) : parameterReplacer : parameter.name;
          parameter.description = paramDescriptionReplacer ? paramDescriptionReplacer : parameter.description;
          if (parameterReplacer) {
            state.message({
              Channel: Channel.Verbose, Text: `[DIRECTIVE] Changed parameter-name from ${prevName} to ${parameter.name}.`
            });
          }

          if (paramDescriptionReplacer) {
            state.message({
              Channel: Channel.Verbose, Text: `[DIRECTIVE] Set parameter-description from parameter ${parameter.name}.`
            });
          }

        }

      } else if (operations) {
        for (const operation of operations) {
          const getCmdletName = (verb: string, subjectPrefix: string, subject: string, variantName: string): string => {
            return `${verb}-${subjectPrefix}${subject}${variantName ? `_${variantName}` : ``}`
          }

          const prevSubject = operation.details.csharp.subject;
          const prevSubjectPrefix = operation.details.csharp.subjectPrefix;
          const prevVerb = operation.details.csharp.verb;
          const prevVariantName = operation.details.csharp.name;
          const oldCommandName = getCmdletName(prevVerb, prevSubjectPrefix, prevSubject, prevVariantName);

          // set values
          operation.details.csharp.subject = subjectReplacer ? subjectRegex ? prevSubject.replace(subjectRegex, subjectReplacer) : subjectReplacer : prevSubject;
          operation.details.csharp.subjectPrefix = subjectPrefixReplacer !== undefined ? subjectPrefixRegex ? prevSubjectPrefix.replace(subjectPrefixRegex, subjectPrefixReplacer) : subjectPrefixReplacer : prevSubjectPrefix;
          operation.details.csharp.verb = verbReplacer ? verbRegex ? prevVerb.replace(verbRegex, verbReplacer) : verbReplacer : prevVerb;
          operation.details.csharp.name = variantReplacer ? variantRegex ? prevVariantName.replace(variantRegex, variantReplacer) : variantReplacer : prevVariantName;
          operation.details.csharp.hidden = (directive.set.hidden !== undefined) ? !!directive.set.hidden : operation.details.csharp.hidden;

          const newSubject = operation.details.csharp.subject;
          const newSubjectPrefix = operation.details.csharp.subjectPrefix;
          const newVerb = operation.details.csharp.verb;
          const newVariantName = operation.details.csharp.name;
          const newCommandName = getCmdletName(newVerb, newSubjectPrefix, newSubject, newVariantName);

          // just the subject prefix can be an empty string
          if (subjectPrefixReplacer !== undefined || subjectReplacer || verbReplacer || variantReplacer) {
            let modificationMessage = `[DIRECTIVE] Changed command from ${oldCommandName} to ${newCommandName}. `
            state.message({
              Channel: Channel.Verbose, Text: modificationMessage
            });
          }
        }
      }

      continue;
    }

    if (isWhereModelDirective(directive)) {
      const selectType = directive.select;
      const modelNameRegex = getParsedSelector(directive.where["model-name"]);
      const propertyNameRegex = getParsedSelector(directive.where["property-name"]);

      const modelNameReplacer = directive.set["model-name"];
      const propertyNameReplacer = directive.set["property-name"];
      const propertyDescriptionReplacer = directive.set["property-description"];

      // select all models
      let models = values(state.model.schemas).linq.toArray();
      if (modelNameRegex) {
        models = values(models)
          .linq.where(model =>
            !!`${model.details.csharp.name}`.match(modelNameRegex))
          .linq.toArray();
      }

      if (propertyNameRegex && selectType === 'model') {
        models = values(models)
          .linq.where(model => values(allVirtualProperties(model.details.csharp.virtualProperties))
            .linq.any(property => !!`${property.name}`.match(propertyNameRegex)))
          .linq.toArray();
      }

      if (propertyNameRegex && (selectType !== undefined || selectType === 'property')) {
        const properties = values(models)
          .linq.selectMany(model => allVirtualProperties(model.details.csharp.virtualProperties))
          .linq.where(property => !!`${property.name}`.match(propertyNameRegex))
          .linq.toArray();
        for (const property of properties) {
          const prevName = property.name;
          property.name = propertyNameReplacer ? propertyNameRegex ? property.name.replace(propertyNameRegex, propertyNameReplacer) : propertyNameReplacer : property.name;
          property.description = propertyDescriptionReplacer ? propertyDescriptionReplacer : property.description;

          if (propertyNameRegex) {
            state.message({
              Channel: Channel.Verbose, Text: `[DIRECTIVE] Changed property-name from ${prevName} to ${property.name}.`
            });
          }
        }

      } else if (models) {
        for (const model of models) {
          const prevName = model.details.csharp.name;
          model.details.csharp.name = modelNameReplacer ? modelNameRegex ? model.details.csharp.name.replace(modelNameRegex, modelNameReplacer) : modelNameReplacer : model.details.csharp.name;
          state.message({
            Channel: Channel.Verbose, Text: `[DIRECTIVE] Changed model-name from ${prevName} to ${model.details.csharp.name}.`
          });
        }
      }

      continue;
    }

    if (isWhereEnumDirective(directive)) {
      const enumNameRegex = getParsedSelector(directive.where["enum-name"]);
      const enumValueNameRegex = getParsedSelector(directive.where["enum-value-name"]);

      const enumNameReplacer = directive.set["enum-name"];
      const enumValueNameReplacer = directive.set["enum-value-name"];

      let enums = values(state.model.schemas)
        .linq.where(each => each.details.csharp.enum !== undefined)
        .linq.toArray();

      if (enumNameRegex) {
        enums = values(enums)
          .linq.where(each => !!`${each.details.csharp.name}`.match(enumNameRegex))
          .linq.toArray();
      }

      if (enumValueNameRegex) {
        const enumsValues = values(enums)
          .linq.selectMany(each => each.details.csharp.enum ? each.details.csharp.enum.values : [])
          .linq.where(each => !!`${each.name}`.match(enumValueNameRegex))
          .linq.toArray();
        for (const enumValue of enumsValues) {
          const prevName = enumValue.name;
          enumValue.name = enumValueNameReplacer ? enumNameRegex ? enumValue.name.replace(enumValueNameRegex, enumValueNameReplacer) : enumValueNameReplacer : prevName;
          if (enumValueNameRegex) {
            const enumNames = values(enums)
              .linq.select(each => each.details.csharp.name)
              .linq.toArray();
            state.message({
              Channel: Channel.Verbose, Text: `[DIRECTIVE] Changed enum-value-name from ${prevName} to ${enumValue.name}. Enum: ${JSON.stringify(enumNames, null, 2)}`
            });
          }
        }
      } else {
        for (const each of enums) {
          const prevName = each.details.csharp.name;
          each.details.csharp.name = enumNameReplacer ? enumNameRegex ? each.details.csharp.name.replace(enumNameRegex, enumNameReplacer) : enumNameReplacer : prevName;
          state.message({
            Channel: Channel.Verbose, Text: `[DIRECTIVE] Changed enum-name from ${prevName} to ${each.details.csharp.name}.`
          });
        }
      }

      continue;
    }
  }

  const operationIdentities = new Set<string>();
  for (const operation of values(state.model.commands.operations)) {
    const details = operation.details.csharp;

    let fname = `${details.verb} -${details.subject} -${details.name} `;
    let n = 1;

    while (operationIdentities.has(fname)) {
      details.name = `${details.name.replace(/\d*$/g, '')} ${n++} `;
      fname = `${details.verb} -${details.subject} -${details.name} `;
    }
    operationIdentities.add(fname);
  }

  return state.model;
}

function isNotRegex(str: string): boolean {
  return /^[a-zA-Z0-9]+$/.test(str);
}
