import * as vscode from "vscode";
import {EOL} from "os";
import { getNextCase, CONFIG } from "./utilities";
import * as _f from "./utilities";
import { IEditBuilderContainer, IConfig } from "./models";

const CASE_CONTEXT = "CASE_CONTEXT";

/** To determine if two arrays is shallow equaled */
const arrayShallowEqual = function(arr1: any[], arr2: any[]) {
	for (let index = 0; index < arr1.length; index++) {
		const item1 = arr1[index];
		const item2 = arr2[index];
		if (item1 !== item2) {
			return false;
			
		}
		
	}
	return true;
	
};

/** On selection changed, save the texts as original texts, and reset current case */
// CHANGED 2021111301 Extract the listener method for reusing, and adding a temp list
const onSelectionChange = function(context: any, options: any, a: any[]) {
	if(a[0].kind === undefined) {
		return;
	}
	options = Object.assign({ updateAllTexts: true, updateAllTextsTemp: true, updateCurrentCase: true}, options);
	const textEditor = vscode.window.activeTextEditor!;
	const globalData = context.globalState.get(CASE_CONTEXT);
	const allTexts: string[] = options.updateAllTexts 
		? textEditor.selections.map((selection: vscode.Selection) => textEditor.document.getText(selection))
		: globalData.allTexts
	;
	const allTextsTemp = options.updateAllTextsTemp ? allTexts.concat([]) : globalData.allTextsTemp;
	const currentCase = options.updateCurrentCase ? CONFIG.ORIGINAL.caseName : globalData.currentCase;
	const promise = globalData.promise;
	context.globalState.update(CASE_CONTEXT, {allTexts, allTextsTemp, currentCase, promise});
	
};

/** Do the case transforming operation */
const logic = (context: vscode.ExtensionContext, options: any={}) => {
	// STEP Number Get configs
	const toggleCaseConfig = vscode.workspace.getConfiguration("toggleCase");
	let allowedCaseConfig: any = toggleCaseConfig.get("case");
	let sequencesConfig: string[] = toggleCaseConfig.get("sequences") || [];
	const notificationConfig: any = toggleCaseConfig.get("notification");
	const camelCaseConvertor = (name: any) => (name ? CONFIG.CAMELCASE.fn(name) : "");
	const allowedCaseConfigReducer = (prev: any, curr: string, index: number, arr: string[]) => {
		prev = prev || {};
		prev[curr] = true;
		return prev;
		
	};
	
	// STEP Number Handle configs
	allowedCaseConfig = Object.keys(allowedCaseConfig).reduce(allowedCaseConfigReducer, {});
	sequencesConfig = sequencesConfig.map(camelCaseConvertor).filter(name => (name && name.trim()));
	
	// STEP Number Handle custom case sequences if asked
	if (options.customSequencesType) {
		const configName = `customSequences${options.customSequencesType}`;
		let customAllowedCaseConfig: any = toggleCaseConfig.get(configName);
		if (!(customAllowedCaseConfig) || (customAllowedCaseConfig.length === 0)) {
			vscode.window.showWarningMessage(`There settings [toggleCase.${configName}] is empty`);
			return;
			
		} else {
			customAllowedCaseConfig = customAllowedCaseConfig
				.map(camelCaseConvertor)
				.filter((name: any) => (name && name.trim()))
			;
			allowedCaseConfig = customAllowedCaseConfig.reduce(allowedCaseConfigReducer, {});
			sequencesConfig = customAllowedCaseConfig;
			
		}
		
	} else if (options.customSequences && options.customSequences.length) {
		allowedCaseConfig = options.customSequences.reduce(allowedCaseConfigReducer, {});
		sequencesConfig = options.customSequences;
		
	}
	
	// CHANGED 2021111301 Check if the current selected texts equal to temp texts, when not, read the selections again
	const textEditor = vscode.window.activeTextEditor!;
	let globalData: any = context.globalState.get(CASE_CONTEXT)!;
	globalData.allTextsTemp = globalData.allTextsTemp || [];
	let {
		allTexts,
		allTextsTemp,
		currentCase
	} = globalData;
	var allTextsNow = textEditor.selections.map((selection: vscode.Selection) => textEditor.document.getText(selection));
	var count = 1;
	while (!(arrayShallowEqual(allTextsNow, allTextsTemp)) && (count ++ <= 10)) {
		// If all the selection is empty, the bug #137118 may happen. (Handled)
		// If we click too quickly,, the bug #137132 may happen.
		// So we try update the cache of origin texts here.
		// After those bugs fixed, this while loop and all the usage of "allTextsNow", "allTextsTemp" should be removed.
		var updateAllTexts = (allTextsTemp.filter((text: string) => text).length === 0);
		onSelectionChange(context, { updateAllTexts: updateAllTexts, updateCurrentCase: false }, [{ "kind": "nonsense" }]);
		globalData = context.globalState.get(CASE_CONTEXT)!;
		globalData.allTextsTemp = globalData.allTextsTemp || [];
		allTexts = globalData.allTexts;
		allTextsTemp = globalData.allTextsTemp;
		currentCase = globalData.currentCase;
		
	}
	
	// STEP Number Get all the text, cache the case changing result
	let editBuilderContainer: IEditBuilderContainer[] = [];
	const changeCaseTo: string = options.changeCaseTo || "";
	const toggleTo = changeCaseTo || getNextCase(currentCase, allowedCaseConfig, sequencesConfig);
	const toggleToObject = (CONFIG as {[x: string]: IConfig})[toggleTo];
	const newRepresentation = toggleToObject.representation;
	const newCase = toggleToObject.caseName;
	textEditor.selections.forEach((selection: vscode.Selection, selectionIndex: number) => {
		if(globalData === undefined || !Array.isArray(allTexts)  || allTexts.length < 1 || !currentCase){
			vscode.window.showInformationMessage("Error! Reload extension and VS Code. Apologies.");
			return;
		}
		
		let modifiedCase = "";
		if(selection.start.line === selection.end.line){
			// single line
			modifiedCase = toggleToObject.fn(allTexts[selectionIndex]);
		}
		else{
			// multiple lines
			let content = allTexts[selectionIndex];
			modifiedCase = content.split(EOL).map((el: string) => toggleToObject.fn(el)).join(EOL);
		}
		editBuilderContainer.push({selection, modifiedCase});
		
	});
	
	// STEP Number Do replace
	textEditor.edit((editBuilder) => {
		editBuilderContainer.forEach((element: IEditBuilderContainer, index: number) => {
			editBuilder.replace(element.selection, element.modifiedCase);
			allTextsNow[index] = element.modifiedCase;
			allTextsTemp[index] = element.modifiedCase;
		});
	});
	
	// STEP Number Update global state
	context.globalState.update(CASE_CONTEXT, {...globalData, currentCase: newCase});
	
	// STEP Number Show notification
	if (notificationConfig.notifyOnChange) {
		vscode.window.showInformationMessage(`Changed to ${newRepresentation}`);
		
	}
	
};

/** Toggle case between upper and lower without cache of original text */
const toggleCaseBetweenUpperAndLower = (context: vscode.ExtensionContext, options: any={}) => {
	const textEditor = vscode.window.activeTextEditor!;
	
	textEditor.edit((editBuilder) => {
		var temp: any = { isFirst: true };
		textEditor.selections.forEach((selection: vscode.Selection, selectionIndex: number) => {
			if (selection.isEmpty) {
				return;
				
			}
			var text = textEditor.document.getText(selection);
			var upperCaseText = text.toUpperCase();
			var lowerCaseText = text.toLowerCase();
			if (upperCaseText === lowerCaseText) {
				return;
				
			}
			if (options.separately || temp.isFirst) {
				temp.toLowerCase = /[A-Z]/g.test(text);
				
			}
			editBuilder.replace(selection, (temp.toLowerCase ? text.toLowerCase() : text.toUpperCase()));
			temp.isFirst = false;
			
		});
		
	});
	
};

/** Module exports */
export function activate(context: vscode.ExtensionContext) {
	// STEP Number Watch the changes of selection, to decide when to save the original text to cache.
	vscode.window.onDidChangeTextEditorSelection((...a) => onSelectionChange(context, {}, a));
	
	// STEP Number Register command for the action to transform to each case
	const SPECIFIC_KEYS = Object.values(CONFIG)
		.filter((el: IConfig) => !["ORIGINAL"].includes(el.caseName))
		.map((el: IConfig) => vscode.commands.registerCommand(
			`extension.changeCase.${el.configParam}`, () => logic(context, { changeCaseTo: el.caseName })
		))
	;
	
	// STEP Number Register other commands
	context.subscriptions.push(
		vscode.commands.registerCommand("extension.toggleCase", () => logic(context)),
		vscode.commands.registerCommand("extension.toggleCaseBetweenUpperAndLower", () => 
			toggleCaseBetweenUpperAndLower(context)
		),
		vscode.commands.registerCommand("extension.toggleCaseBetweenUpperAndLowerSeparately", () => 
			toggleCaseBetweenUpperAndLower(context, { separately: true })
		),
		vscode.commands.registerCommand("extension.toggleCaseBetweenUpperLowerAndOriginal", () => 
			logic(context, { customSequences: ["original", "upperCase", "lowerCase"] })
		),
		vscode.commands.registerCommand("extension.customToggleCase1", () => logic(context, { customSequencesType: 1 })),
		vscode.commands.registerCommand("extension.customToggleCase2", () => logic(context, { customSequencesType: 2 })),
		vscode.commands.registerCommand("extension.customToggleCase3", () => logic(context, { customSequencesType: 3 })),
		vscode.commands.registerCommand("extension.customToggleCase4", () => logic(context, { customSequencesType: 4 })),
		vscode.commands.registerCommand("extension.customToggleCase5", () => logic(context, { customSequencesType: 5 })),
		...SPECIFIC_KEYS
	);
	
}

export function deactivate() {}
