/*
 * Adapted from eslint-plugin-react v7.37.5 lib/rules/no-deprecated.js,
 * lib/util/componentUtil.js and lib/util/pragma.js by Yannick Croissant,
 * Scott Feeney and Sergei Startsev. Uses ESLint 10's public SourceCode API.
 * https://github.com/jsx-eslint/eslint-plugin-react/tree/v7.37.5
 *
 * The MIT License (MIT)
 * Copyright (c) 2014 Yannick Croissant
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import semver from 'semver';

const modules = {
	react: ['React'],
	'react-addons-perf': ['ReactPerf', 'Perf'],
	'react-dom': ['ReactDOM'],
	'react-dom/server': ['ReactDOMServer'],
};

function deprecatedMethods(pragma) {
	const methods = {
		[`${pragma}.renderComponent`]: ['0.12.0', `${pragma}.render`],
		[`${pragma}.renderComponentToString`]: ['0.12.0', `${pragma}.renderToString`],
		[`${pragma}.renderComponentToStaticMarkup`]: ['0.12.0', `${pragma}.renderToStaticMarkup`],
		[`${pragma}.isValidComponent`]: ['0.12.0', `${pragma}.isValidElement`],
		[`${pragma}.PropTypes.component`]: ['0.12.0', `${pragma}.PropTypes.element`],
		[`${pragma}.PropTypes.renderable`]: ['0.12.0', `${pragma}.PropTypes.node`],
		[`${pragma}.isValidClass`]: ['0.12.0'],
		'this.transferPropsTo': ['0.12.0', 'spread operator ({...})'],
		[`${pragma}.addons.classSet`]: ['0.13.0', 'the npm module classnames'],
		[`${pragma}.addons.cloneWithProps`]: ['0.13.0', `${pragma}.cloneElement`],
		[`${pragma}.render`]: ['0.14.0', 'ReactDOM.render'],
		[`${pragma}.unmountComponentAtNode`]: ['0.14.0', 'ReactDOM.unmountComponentAtNode'],
		[`${pragma}.findDOMNode`]: ['0.14.0', 'ReactDOM.findDOMNode'],
		[`${pragma}.renderToString`]: ['0.14.0', 'ReactDOMServer.renderToString'],
		[`${pragma}.renderToStaticMarkup`]: ['0.14.0', 'ReactDOMServer.renderToStaticMarkup'],
		[`${pragma}.addons.LinkedStateMixin`]: ['15.0.0'],
		'ReactPerf.printDOM': ['15.0.0', 'ReactPerf.printOperations'],
		'Perf.printDOM': ['15.0.0', 'Perf.printOperations'],
		'ReactPerf.getMeasurementsSummaryMap': ['15.0.0', 'ReactPerf.getWasted'],
		'Perf.getMeasurementsSummaryMap': ['15.0.0', 'Perf.getWasted'],
		[`${pragma}.createClass`]: ['15.5.0', 'the npm module create-react-class'],
		[`${pragma}.addons.TestUtils`]: ['15.5.0', 'ReactDOM.TestUtils'],
		[`${pragma}.PropTypes`]: ['15.5.0', 'the npm module prop-types'],
		[`${pragma}.DOM`]: ['15.6.0', 'the npm module react-dom-factories'],
		'ReactDOM.render': [
			'18.0.0',
			'createRoot',
			'https://reactjs.org/link/switch-to-createroot',
		],
		'ReactDOM.hydrate': [
			'18.0.0',
			'hydrateRoot',
			'https://reactjs.org/link/switch-to-createroot',
		],
		'ReactDOM.unmountComponentAtNode': [
			'18.0.0',
			'root.unmount',
			'https://reactjs.org/link/switch-to-createroot',
		],
		'ReactDOMServer.renderToNodeStream': [
			'18.0.0',
			'renderToPipeableStream',
			'https://reactjs.org/docs/react-dom-server.html#rendertonodestream',
		],
	};
	for (const name of ['componentWillMount', 'componentWillReceiveProps', 'componentWillUpdate']) {
		methods[name] = [
			'16.9.0',
			`UNSAFE_${name}`,
			`https://reactjs.org/docs/react-component.html#unsafe_${name.toLowerCase()}. Use https://github.com/reactjs/react-codemod#rename-unsafe-lifecycles to automatically update your components.`,
		];
	}
	return methods;
}

export default {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow deprecated React methods',
			url: 'https://github.com/jsx-eslint/eslint-plugin-react/blob/v7.37.5/docs/rules/no-deprecated.md',
		},
		schema: [],
		messages: {
			deprecated: '{{oldMethod}} is deprecated since React {{version}}{{newMethod}}{{refs}}',
		},
	},
	create(context) {
		const sourceCode = context.sourceCode;
		const settings = context.settings.react || {};
		const annotation = sourceCode
			.getAllComments()
			.map((comment) => /@jsx\s+([^\s]+)/.exec(comment.value))
			.find(Boolean);
		let pragma = annotation ? annotation[1].split('.')[0] : settings.pragma || 'React';
		if (!/^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(pragma)) pragma = 'React';
		const createClass = settings.createClass || 'createReactClass';
		if (!/^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(createClass))
			throw new Error(`createClass pragma ${createClass} is not a valid function name`);
		// The project config supplies the installed React version, rather than
		// loading React or guessing a latest version inside each lint listener.
		const version =
			semver.coerce(String(settings.version || settings.defaultVersion || '999.999.999')) ||
			semver.coerce('999.999.999');
		const deprecated = deprecatedMethods(pragma);
		function check(node, name) {
			const entry = Object.hasOwn(deprecated, name) && deprecated[name];
			if (!entry || !semver.satisfies(version, `>= ${entry[0]}`)) return;
			context.report({
				node,
				messageId: 'deprecated',
				data: {
					oldMethod: name,
					version: entry[0],
					newMethod: entry[1] ? `, use ${entry[1]} instead` : '',
					refs: entry[2] ? `, see ${entry[2]}` : '',
				},
			});
		}
		function checkComponent(node) {
			const callee = node.parent?.callee;
			const es5 =
				callee &&
				(callee.type === 'MemberExpression'
					? callee.object.name === pragma && callee.property.name === createClass
					: callee.type === 'Identifier' && callee.name === createClass);
			const parent = node.superClass;
			const es6 =
				parent &&
				(parent.type === 'MemberExpression'
					? parent.object.name === pragma &&
						/^(Pure)?Component$/.test(parent.property.name)
					: parent.type === 'Identifier' && /^(Pure)?Component$/.test(parent.name));
			// The old plugin also recognized explicitly annotated component classes.
			const declaration =
				node.parent?.type === 'ExportDefaultDeclaration' ||
				node.parent?.type === 'ExportNamedDeclaration'
					? node.parent
					: node;
			const comment = sourceCode.getCommentsBefore(declaration).at(-1);
			const explicit =
				comment?.type === 'Block' &&
				comment.value.startsWith('*') &&
				/@(extends|augments)\s+(?:\{\s*)?React\.(?:Pure)?Component\b/.test(comment.value);
			if (!es5 && !es6 && !explicit) return;
			const properties = node.type === 'ObjectExpression' ? node.properties : node.body.body;
			for (const property of properties)
				if (property.key) check(property.key, property.key.name);
		}
		return {
			MemberExpression(node) {
				check(node, sourceCode.getText(node));
			},
			ImportDeclaration(node) {
				const names = modules[node.source.value];
				if (!names) return;
				for (const specifier of node.specifiers)
					if (specifier.imported)
						check(specifier, `${names[0]}.${specifier.imported.name}`);
			},
			VariableDeclarator(node) {
				if (node.id.type !== 'ObjectPattern' || !node.init) return;
				let moduleName;
				for (const [name, names] of Object.entries(modules)) {
					if (node.init.arguments?.[0]?.value === name) moduleName = names[0];
					else moduleName = names.find((candidate) => candidate === node.init.name);
					if (moduleName) break;
				}
				if (!moduleName) return;
				for (const property of node.id.properties)
					if (property.type !== 'RestElement' && property.key)
						check(property, `${moduleName}.${property.key.name}`);
			},
			ClassDeclaration: checkComponent,
			ClassExpression: checkComponent,
			ObjectExpression: checkComponent,
		};
	},
};
