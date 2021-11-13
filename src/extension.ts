import * as vscode from 'vscode';
import {EOL} from 'os';
import { getNextCase, CONFIG } from './utilities';
import * as _f from './utilities';
import { IEditBuilderContainer, IConfig } from './models';

const CASE_CONTEXT = "CASE_CONTEXT";

// CHANGED 2021111301 There is some problems for vscode to get text when watching changes
//                    - When we choose selection with Ctrl + Shift + Left/Right, the event "onDidChangeTextEditorSelection" will not be fired.

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

const logic = (context: vscode.ExtensionContext, changeCaseTo: string = "") => {
	const config = vscode.workspace.getConfiguration('toggleCase.case');
	const notificationConfig = vscode.workspace.getConfiguration('toggleCase.notification');
	const textEditor = vscode.window.activeTextEditor!;
	
	let editBuilderContainer: IEditBuilderContainer[] = [];
	
	// CHANGED 2021111301 Check if the current selected texts equal to temp texts, when not, read the selections again
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
		// If all the selection is empty, the bug #137118 may happen, so we try update the origin texts.
		// After this bug fixed, this while loop and all the usage of "allTextsNow", "allTextsTemp" should be removed.
		var updateAllTexts = (allTextsTemp.filter((text: string) => text).length === 0);
		onSelectionChange(context, { updateAllTexts: updateAllTexts, updateCurrentCase: false }, [{ "kind": "nonsense" }]);
		globalData = context.globalState.get(CASE_CONTEXT)!;
		globalData.allTextsTemp = globalData.allTextsTemp || [];
		allTexts = globalData.allTexts;
		allTextsTemp = globalData.allTextsTemp;
		currentCase = globalData.currentCase;
		
	}
	const toggleTo = changeCaseTo || getNextCase(currentCase, config);
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
	
	textEditor.edit((editBuilder) => {
		editBuilderContainer.forEach((element: IEditBuilderContainer, index: number) => {
			editBuilder.replace(element.selection, element.modifiedCase);
			allTextsNow[index] = element.modifiedCase;
			allTextsTemp[index] = element.modifiedCase;
		});
	});
	
	context.globalState.update(CASE_CONTEXT, {...globalData, currentCase: newCase});
	if (notificationConfig.notifyOnChange) {
		vscode.window.showInformationMessage(`Changed to ${newRepresentation}`);
		
	}
	
};

export function activate(context: vscode.ExtensionContext) {
	
	vscode.window.onDidChangeTextEditorSelection((...a) => onSelectionChange(context, {}, a));
	
	const SPECIFIC_KEYS = Object.values(CONFIG)
		.filter((el: IConfig) => !["ORIGINAL"].includes(el.caseName))
		.map((el: IConfig) => vscode.commands.registerCommand(`extension.changeCase.${el.configParam}`, () => logic(context, el.caseName)))
	;
	
	context.subscriptions.push(
		vscode.commands.registerCommand('extension.toggleCase', () => logic(context)),
		...SPECIFIC_KEYS
	);
	
}

export function deactivate() {}
